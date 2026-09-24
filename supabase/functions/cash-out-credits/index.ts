import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { formatPayoutDollars } from "../_shared/money.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const rl = await checkRateLimit(req, {
    windowMs: 60_000,
    maxRequests: 5,
    keyPrefix: "cash-out-credits",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter ?? 60, corsHeaders);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    { auth: { persistSession: false } }
  );

  try {
    // Authenticate user. An auth rejection returns 401 DIRECTLY, before the
    // generic catch turns it into a 500 (EF-03, hole hunt 2026-09-15): a 500
    // on this money path reads as "the charge broke" and drowns real 500s in
    // noise from every expired-session and bot hit, and tells the client to
    // retry when it should re-authenticate.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401 }
      );
    }
    const userId = userData.user.id;

    // Stable per-attempt id supplied by the client (a UUID it generates once per
    // cash-out and REUSES across retries of the same attempt). This is what the
    // Stripe idempotency key binds to — see HM-1 below. It is read here, before
    // any claim, because the whole point is that it does not depend on which
    // credits happen to be unredeemed at transfer time.
    let attemptId: string | null = null;
    try {
      const body = await req.json();
      const raw = body?.attemptId;
      // Accept only a well-formed UUID; anything else is treated as absent so a
      // malformed value can never collide two unrelated cash-outs onto one key.
      if (typeof raw === "string" && UUID_RE.test(raw)) attemptId = raw.toLowerCase();
    } catch {
      // No/'' body (older clients call invoke with no args) → attemptId stays
      // null and we fall back to the legacy per-claim key below.
    }

    // Get user's Stripe Connect account
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("user_id", userId)
      .single();

    // Distinguish a transient read failure from a genuine "no account" — a
    // dropped error here would falsely tell a helper WITH a Connect account to
    // go re-onboard, and this read gates the whole payout.
    if (profileErr) {
      console.error(`[cash-out-credits] profile read failed for ${userId}:`, profileErr);
      return new Response(
        JSON.stringify({ error: "We couldn't verify your payout account right now. Please try again in a moment." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
      );
    }

    if (!profile?.stripe_account_id) {
      return new Response(
        JSON.stringify({ error: "You need to connect a Stripe account before cashing out. Go to your Profile to set this up." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Race-safe atomic claim: flip redeemed=true FIRST and return only the
    // rows this call actually claimed. A concurrent double-tap/retry that
    // reads the same unredeemed rows will claim zero here (the .eq filter no
    // longer matches), so only one request ever transfers. Without this the
    // read→transfer→mark sequence let two requests pay out the same credits.
    const { data: claimed, error: claimError } = await supabase
      .from("referral_credits")
      .update({ redeemed: true })
      .eq("user_id", userId)
      .eq("redeemed", false)
      .select("id, amount");

    if (claimError) throw new Error("Failed to load credits");
    if (!claimed || claimed.length === 0) {
      return new Response(
        JSON.stringify({ error: "No available credits to cash out." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    const creditIds = claimed.map((c) => c.id);
    const totalAmount = claimed.reduce((sum, c) => sum + Number(c.amount), 0);
    const totalCents = Math.round(totalAmount * 100);

    // Roll back the claim helper — credits must not be lost if we bail or the
    // transfer fails, so we flip redeemed back to false for the claimed rows.
    //
    // This used to be `rollbackClaim().catch(...)` at both call sites, and it
    // could never have worked. A PostgrestFilterBuilder is a *thenable*: it
    // implements `then` and nothing else, so `.catch` is `undefined` and
    // `rollbackClaim().catch(fn)` throws `TypeError: ... .catch is not a
    // function` — synchronously, BEFORE the update was ever awaited. Both
    // rollbacks therefore never ran: a sub-$1 cash-out attempt 500'd instead of
    // returning its 400, and a failed Stripe transfer threw the TypeError in
    // place of the real transfer error. In both cases the user's credits were
    // left `redeemed = true` with no payout — permanently lost, silently.
    //
    // And even with a working `.catch`, postgrest does not REJECT on a database
    // error; it resolves with `{ error }`. So the error had to be read off the
    // result, not caught. `.select("id")` + a row count is the house rule for
    // any write touching money (CLAUDE.md): a zero-row UPDATE returns
    // `{ data: [], error: null }`, which is the same "credits lost" outcome
    // wearing a success mask.
    const rollbackClaim = async (context: string) => {
      try {
        const { data, error } = await supabase
          .from("referral_credits")
          .update({ redeemed: false })
          .in("id", creditIds)
          .select("id");
        if (error || (data?.length ?? 0) !== creditIds.length) {
          console.error(
            `[cash-out-credits] CRITICAL: ${context} rollback failed — credits may be permanently lost`,
            {
              creditIds,
              rolledBack: data?.length ?? 0,
              rollbackError: error?.message ?? null,
              userId,
            },
          );
        }
      } catch (rollbackErr: unknown) {
        console.error(
          `[cash-out-credits] CRITICAL: ${context} rollback threw — credits may be permanently lost`,
          {
            creditIds,
            rollbackError: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
            userId,
          },
        );
      }
    };

    if (totalCents < 100) {
      // Rollback failure here is the same risk as in the transfer catch block:
      // credits stay redeemed=true with no payout, logged loudly so ops can
      // find and manually reset the row(s).
      await rollbackClaim("minimum-amount");
      return new Response(
        JSON.stringify({ error: "Minimum cash-out amount is $1.00." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Create Stripe transfer to connected account
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    // HM-1: bind the Stripe idempotency key to a STABLE per-attempt id, never to
    // the claimed credit set. Deriving it from the set (the old behaviour, kept
    // only as a legacy fallback below) double-pays on this sequence: a transfer
    // succeeds but its response is lost → the catch rolls the claim back → a new
    // credit accrues → the retry claims a DIFFERENT set → a different hash → a
    // different key → Stripe does not dedupe and sends a second transfer. A
    // client-supplied attempt id is the same across that retry, so Stripe
    // replays the original transfer regardless of which credits are unredeemed
    // now — mirroring instant-payout's persisted-record key.
    //
    // Fallback (no attemptId): the legacy set hash. It still dedupes a retry
    // that claims the SAME set (the common case), and it preserves behaviour for
    // already-deployed clients that call this with no body. The durable fix
    // (a persisted cash-out ledger row so reconciliation can see the outflow)
    // is noted for the lead.
    const idempotencyKey = attemptId
      ? `cashout-${attemptId}`
      : `cashout-${await sha256Hex(creditIds.slice().sort().join(","))}`;

    let transfer;
    try {
      transfer = await stripe.transfers.create(
        {
          amount: totalCents,
          currency: "usd",
          destination: profile.stripe_account_id,
          description: `Helpr referral credit cash-out ($${totalAmount.toFixed(2)})`,
          // ME-013: without these the transfer could not be tied back to a
          // user or to the credits it paid.
          metadata: {
            type: "referral_cashout",
            user_id: userId,
            credit_count: String(creditIds.length),
          },
        },
        { idempotencyKey }
      );
    } catch (transferError) {
      // Transfer failed — release the claim so the user keeps their credits.
      // If the rollback itself fails, the credits stay redeemed=true with no
      // payout — log critically so ops can manually reset the row(s).
      await rollbackClaim("transfer-failed");
      throw transferError;
    }

    // ME-013: the ledger half. redeemed=true alone recorded neither the
    // transfer nor the time. The money has moved, so a failed stamp must not
    // fail the request; it is logged with the transfer id so it can be filled.
    const { data: stamped, error: stampErr } = await supabase
      .from("referral_credits")
      .update({ redeemed_at: new Date().toISOString(), stripe_transfer_id: transfer.id })
      .in("id", creditIds)
      .select("id");
    if (stampErr || !stamped || stamped.length !== creditIds.length) {
      console.error(
        `CRITICAL: [cash-out-credits] transfer ${transfer.id} SENT but ${stampErr ? `the ledger stamp failed: ${stampErr.message}` : `stamped ${stamped?.length ?? 0} of ${creditIds.length} credits`} (user ${userId}, credits ${creditIds.join(",")})`,
      );
    }

    // Notify user. The transfer already succeeded, so a failed notification
    // must not fail the request — but log it so a missing "cash-out successful"
    // alert is traceable rather than silently dropped.
    const { error: notifErr } = await supabase.from("notifications").insert({
      user_id: userId,
      title: "Cash-out successful!",
      message: `$${formatPayoutDollars(totalAmount)} in referral credits has been sent to your connected Stripe account.`,
      type: "payment",
      // Earnings & Payouts, not the Profile landing tab.
      link: "/profile?tab=earnings",
    });
    if (notifErr) console.error(`[cash-out-credits] success notification insert failed for user ${userId} (transfer ${transfer.id}):`, notifErr);

    return new Response(
      JSON.stringify({
        success: true,
        amount: totalAmount,
        transfer_id: transfer.id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("[cash-out-credits] error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
