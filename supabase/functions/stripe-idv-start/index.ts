import { serve } from "../_shared/buildStamp.ts";
import { refuseUnconfirmedEmail } from "../_shared/requireConfirmedEmail.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getAppUrl, buildRedirectUrl, isNativeRequest } from "../_shared/appUrl.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { refuseLiveOnlyForTestOrSeed, stripeModeRefusedResponse } from "../_shared/stripeMode.ts";

/** Profile states whose stored session is read at Stripe before anything is claimed. */
const RESUMABLE_OR_REVIEW = ["pending", "processing", "manual_review"];
/** Profile states a member may restart from (with a finished or unreadable previous session). */
const RESTART_FROM = ["manual_review", "pending", "not_started"];
/** Stripe session states that mean the previous check is over without a verdict. */
const RESTART_AFTER = ["requires_input", "canceled"];

function restartAllowed(idvStatus: string | null, previousReadable: boolean, previousStatus: string | null): boolean {
  if (!RESTART_FROM.includes(idvStatus ?? "not_started")) return false;
  return !previousReadable || RESTART_AFTER.includes(previousStatus ?? "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // First of two guards, and the broader one. It is now durable and keyed to
  // the caller's JWT subject (20260902035752) rather than the in-process,
  // header-keyed Map it used to be — that Map reset on every cold start and let
  // a caller pick its own bucket, so this comment used to describe a cap that
  // was never applied to anybody.
  //
  // 10/min, raised from 3 for the same reason: the number is enforced now, and
  // 3 is inside normal use. `IDVPromptDialog` chains
  // `start → 402 needsOnboardingFee → pay the fee → start again`, which spends
  // two legitimately, and one user retry after a Stripe hiccup spends the third.
  //
  // The BILLING cap is unchanged and is the one that matters: `claim_idv_attempt`
  // below (20260827193414 / 20260829031405), which is durable, keyed to the
  // user, and allows exactly one paid attempt before manual review. This just
  // keeps a burst from reaching it.
  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 10,
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
    const body = await req.json().catch(() => ({}));
    const isNative = isNativeRequest(body);
    // NO FEE GATE (owner, 2026-10-21): Stripe Identity is required before a
    // member's first posted job or hire; the one-time setup fee covers it. The
    // poster's $2 first-job setup fee is unchanged and is charged where it always
    // was, at the first job's checkout; this function never charged it and never
    // marks it paid, so skipping the old "settle the fee first" check can neither
    // drop nor double it (pinned: src/test/identityGatesPostAndStart.test.ts, "THE $2").
    const skipFeeGate = true;
    // Where Stripe sends the member back: an in-app path only (a leading "/",
    // never "//" or a scheme), else Home. Home opens the ID sheet on idv=complete.
    const rawReturn = (body as { return_path?: unknown })?.return_path;
    const returnPath = typeof rawReturn === "string" && /^\/(?![\/\\])[A-Za-z0-9/_\-?=&.]*$/.test(rawReturn) && rawReturn.length <= 200
      ? rawReturn
      : "/home";
    const returnWithFlag = `${returnPath}${returnPath.includes("?") ? "&" : "?"}idv=complete`;
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
    // Q837: an unconfirmed-email caller is refused here, as Q807 refuses at
    // the table (that gate cannot see the caller behind a service-role write).
    const unconfirmedEmail = refuseUnconfirmedEmail(user, corsHeaders);
    if (unconfirmedEmail) return unconfirmedEmail;

    // ID check off (switch `identity_check`, owner 2026-10-23: "just remove the
    // verify id entirely"): nothing is required, so no check is started and no
    // Stripe call is made. The app shows no ID prompt while off; this stops an
    // old build or a direct call. A switch read that FAILS is not "off": the
    // gates may still require the ID, so it says "try again" (503), never
    // "nothing is needed" (lh-silent-failure #4). Asked for the verified caller.
    const { data: idSwitch, error: idSwitchErr } = await supabaseAdmin.rpc("feature_enabled_for_user", {
      p_key: "identity_check",
      p_user_id: user.id,
    });
    if (idSwitchErr) {
      console.error(`[stripe-idv-start] identity_check switch read failed for ${user.id}: ${idSwitchErr.message}`);
      return fail(503, "We couldn't start an ID check right now. Try again in a moment.");
    }
    if (idSwitch !== true) {
      return fail(409, "ID checks are turned off right now. Nothing is needed from you.", { code: "identity_check_off" });
    }

    // Stripe Identity runs only on the LIVE key (no test-mode endpoint), and a
    // live check is billed: a test account, or a test-looking account that is
    // not enrolled, is refused before any Stripe call (Oct 2026 audit, finding 7).
    const liveOnlyRefusal = await refuseLiveOnlyForTestOrSeed(supabaseAdmin, user.id);
    if (liveOnlyRefusal) return stripeModeRefusedResponse(liveOnlyRefusal, corsHeaders);

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

    // Already verified (Stripe Identity, or an admin-approved ID): THE one rule,
    // public.is_identity_verified, which since 2026-10-21 is Stripe Identity only
    // (payout setup is not an ID check). Verified once is never asked again. An unreadable
    // answer is not permission to start a check: it throws, like profileErr.
    // PGRST202 (the function's migration not deployed yet) falls back to the
    // old answer below plus claim_idv_attempt's own already_verified, so a
    // deploy-order gap degrades to the previous behaviour, never to an outage.
    const { data: verifiedAnyRoute, error: verifiedErr } = await supabaseAdmin.rpc("is_identity_verified", { p_user_id: user.id });
    if (verifiedErr && verifiedErr.code !== "PGRST202") {
      throw new Error(`is_identity_verified failed: ${verifiedErr.message}`);
    }
    if (verifiedErr) console.warn("[stripe-idv-start] is_identity_verified not deployed yet (PGRST202): falling back to idv_status");
    if (verifiedAnyRoute === true || (verifiedErr && profile?.idv_status === "verified")) {
      return new Response(JSON.stringify({ alreadyVerified: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // The previous session, read at Stripe (free: no claim, no new session).
    // A pending/processing one that still takes input is handed back as is.
    // Its status also decides whether a FRESH check may start below.
    let previousReadable = false;
    let previousStatus: string | null = null;
    if (profile?.idv_session_id && RESUMABLE_OR_REVIEW.includes(profile.idv_status ?? "")) {
      try {
        const existing = await stripe.identity.verificationSessions.retrieve(profile.idv_session_id);
        previousReadable = true;
        previousStatus = existing.status;
        if (profile.idv_status !== "manual_review" && existing.status === "requires_input" && existing.url) {
          return new Response(JSON.stringify({ url: existing.url, sessionId: existing.id }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }
      } catch (e) {
        // Only Stripe's "no such session" (gone, or made on the other mode: an
        // old-flow test session) counts as finished for the restart below. A
        // rate limit, a 5xx or a network blip is not an answer: a session Stripe
        // is still processing or has verified must never be restarted past
        // (lh-authz-rls review, finding 1), so fail closed and let them retry.
        const code = (e as { code?: unknown; statusCode?: unknown } | null)?.code;
        const http = (e as { statusCode?: unknown } | null)?.statusCode;
        if (code !== "resource_missing" && http !== 404) {
          console.error("[stripe-idv-start] could not read the previous session:", (e as { message?: string })?.message);
          return fail(503, "We couldn't reach your ID check just now. Please try again in a moment.");
        }
        previousReadable = false;
      }
    }

    // ALREADY VERIFIED AT STRIPE (owner 2026-10-30, D1): 16 members verified by Stripe were reset
    // to not_started on 2026-10-27 and still hold their session id. Ask Stripe about it: verified,
    // and for this member, is recorded with no new session, so nobody checks or is billed twice.
    // An unreadable or missing session falls through to the normal start.
    if (profile?.idv_session_id && profile.idv_status === "not_started") {
      try {
        const stored = await stripe.identity.verificationSessions.retrieve(profile.idv_session_id);
        if (stored.status === "verified" && stored.metadata?.user_id === user.id) {
          const { data: restored, error: restoreErr } = await supabaseAdmin.from("profiles")
            .update({ idv_status: "verified", idv_failure_reason: null })
            .eq("user_id", user.id).eq("idv_status", "not_started").select("user_id");
          if (restoreErr) throw new Error(`restoring a verified session failed: ${restoreErr.message}`);
          if ((restored?.length ?? 0) > 0) {
            return new Response(JSON.stringify({ alreadyVerified: true }), {
              headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
            });
          }
        }
      } catch (e) {
        const code = (e as { code?: unknown } | null)?.code;
        const http = (e as { statusCode?: unknown } | null)?.statusCode;
        const gone = code === "resource_missing" || http === 404;
        if (!gone) {
          console.error("[stripe-idv-start] could not read the stored session:", (e as { message?: string })?.message);
          return fail(503, "We couldn't reach your ID check just now. Please try again in a moment.");
        }
      }
    }

    // RESTART (owner report 2026-10-21): a check stuck "with our team", or a
    // pending one that can no longer be resumed, may start a FRESH session when
    // the previous one is requires_input or canceled at Stripe, or cannot be
    // read. Never while Stripe is still processing it or has verified it (a
    // verified-but-held check is a person's call). claim_idv_attempt still
    // refuses a ban, an admin's rejection ('failed') and a fourth attempt, and
    // never writes 'verified'.
    const restart = restartAllowed(profile?.idv_status ?? null, previousReadable, previousStatus);

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
    let { data: claimRaw, error: claimErr } = await supabaseAdmin.rpc("claim_idv_attempt", {
      p_user_id: user.id,
      p_skip_fee_gate: skipFeeGate,
      p_restart: restart,
    });
    if (claimErr?.code === "PGRST202" && restart) {
      // The 4-argument claim (20261021135734) not deployed yet: the old claim,
      // which never restarts. A deploy-order gap degrades to the old refusal.
      console.warn("[stripe-idv-start] claim_idv_attempt(p_restart) not deployed yet (PGRST202): no restart");
      ({ data: claimRaw, error: claimErr } = await supabaseAdmin.rpc("claim_idv_attempt", {
        p_user_id: user.id,
        p_skip_fee_gate: skipFeeGate,
      }));
    }
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
        case "onboarding_fee_unpaid": {
          // The one refusal with a way out, so it says so explicitly and the
          // client turns `needsOnboardingFee` into a pay-now button. The amount
          // is read from platform_settings like every other path that quotes
          // it (pay-onboarding-fee, the Terms page) — this string carried a
          // hard-coded "$2" that would have gone stale the day the setting
          // changed. Read failure just drops the number; the refusal stands.
          const { data: feeRow } = await supabaseAdmin
            .from("platform_settings")
            .select("onboarding_fee_cents")
            .limit(1)
            .maybeSingle();
          const feeCents = Number(feeRow?.onboarding_fee_cents);
          const feeText = Number.isFinite(feeCents) && feeCents > 0
            ? ` — it's the same $${(feeCents / 100).toFixed(feeCents % 100 === 0 ? 0 : 2)} you'd otherwise pay on your first job post or first payout, never both`
            : " — it's the same fee you'd otherwise pay on your first job post or first payout, never both";
          return fail(
            402,
            `Your one-time account setup fee covers this check. Settle it and verification opens up${feeText}.`,
            { needsOnboardingFee: true },
          );
        }
        case "attempt_limit_reached":
        case "in_manual_review":
          // STRANDED 'pending' (review 2026-10-21): the one attempt is spent and
          // its session could not be resumed above (never submitted, and gone or
          // no longer requires_input), so nothing would ever move it, and the
          // admin queue lists only manual_review. Hand it to a person, so the
          // words below are true.
          if (claim.reason === "attempt_limit_reached" && profile?.idv_status === "pending") {
            const { error: queueErr } = await supabaseAdmin
              .from("profiles")
              .update({
                idv_status: "manual_review",
                legacy_manual_review: true,
                idv_failure_reason: "The earlier ID check could not be resumed",
              } as any)
              .eq("user_id", user.id)
              .eq("idv_status", "pending");
            if (queueErr) {
              // Not "with our team" when it isn't: say so and let them retry.
              console.error("[stripe-idv-start] could not queue a stranded pending check for review:", queueErr.message);
              return fail(503, "We couldn't reach your ID check just now. Please try again in a moment.");
            }
          }
          // Not a dead end and not a "get in touch": the account is already in
          // the admin identity review queue, and the only thing the person has
          // to do is wait. Saying anything else invites them to hunt for a
          // retry that deliberately does not exist.
          return fail(
            429,
            "Your ID check is with our team now. We review these by hand and email you as soon as it's done — usually within 24 hours.",
            { attemptLimitReached: true, inManualReview: true },
          );
        case "account_restricted":
          return fail(403, "This account can't start verification right now.");
        case "rejected":
          // An admin's decision (or a match to a removed account) stands; only
          // an admin moves it. The sheet shows its "couldn't verify" state.
          return fail(403, "We couldn't verify this ID. Get in touch and we'll help you sort it out.", { rejected: true });
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
      return_url: buildRedirectUrl(returnWithFlag, isNative),
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
    // Generic client-safe message; detail is logged above (EF-5, 2026-09-15).
    return new Response(JSON.stringify({ error: "We couldn't start identity verification right now. Please try again." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
