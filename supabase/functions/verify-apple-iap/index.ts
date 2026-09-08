// Verify an Apple In-App Purchase and grant the subscription tier it bought.
//
// Called by the native iOS client immediately after a successful StoreKit
// purchase. The client sends ONLY a transactionId; we re-fetch the
// authoritative transaction from Apple (see _shared/appleAppStore.ts), so a
// tampered client cannot grant itself a tier it never paid for.
//
// ── Rebuilt from the unmerged feat/apple-iap branch, which could not ship ────
//
// The branch version granted the tier with:
//
//     .update({...}).eq("id", user.id)
//
// `profiles.id` is NOT `auth.users.id`. Measured against prod on 2026-09-05:
// 43 of 43 rows have `id <> user_id` — zero match, in every case. So the UPDATE
// matched no rows, supabase-js returned `{ data: [], error: null }` (a zero-row
// write is not an error), the function returned HTTP 200 with
// `{ tier, expires_at }`, and NOTHING WAS WRITTEN. The member pays Apple real
// money and silently receives no tier, with no error anywhere to notice.
//
// The duplicate-claim guard was broken by the same mistake in the opposite
// direction: it selected `id` and compared it to `auth.uid()`, which never
// matches, so any found row read as "belongs to someone else" and a legitimate
// Restore Purchases was rejected as "linked to a different account".
//
// Hence, below: `user_id` throughout, and every write asserts it touched a row.
//
// ── Why this never REFUSES a paid purchase ──────────────────────────────────
//
// The owner's rule for a member holding both an Apple and a Stripe
// subscription is to PREVENT IT AT PURCHASE TIME, and
// `subscription_purchase_eligibility()` does that BEFORE the purchase sheet
// opens. By the time this function runs Apple has already taken the money, so
// a "you already have a subscription" refusal here would leave someone charged
// and unentitled — converting a rare double-subscription into a guaranteed
// theft. When the pre-check is bypassed, raced, or simply offline, the only
// safe move is to GRANT and FLAG. That asymmetry is deliberate.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { TIER_FEE_PERCENT, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import {
  computeExpiry,
  fetchAppleTransaction,
  resolveProduct,
} from "../_shared/appleAppStore.ts";

/**
 * Rank tiers by their COMMISSION rather than a hand-written order list.
 *
 * A lower platform fee is strictly a better tier (free 12 → basic 11 → pro 10
 * → elite 8), so the fee table already encodes the ladder and cannot disagree
 * with itself. A hand-written `["basic","pro","elite"]` here would be one more
 * registry to forget when a tier is added — the exact failure that shipped
 * `price_TODO_LIVE_PLUS_*`. Add a 9% tier and it slots in correctly with no
 * change to this file.
 */
function tierRank(tier: string | null | undefined): number {
  if (!tier || tier === "free") return -DEFAULT_TIER_FEE_PERCENT;
  return -(TIER_FEE_PERCENT[tier] ?? DEFAULT_TIER_FEE_PERCENT);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401, corsHeaders);
    const { data: userData } = await authClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    const user = userData.user;
    if (!user) return errorResponse("User not authenticated", 401, corsHeaders);

    const { transactionId } = await req.json();
    if (!transactionId || typeof transactionId !== "string") {
      return errorResponse("transactionId is required", 400, corsHeaders);
    }

    // ── The trust boundary ──────────────────────────────────────────────────
    const tx = await fetchAppleTransaction(transactionId);
    const meta = resolveProduct(tx.productId);
    if (!meta) {
      return errorResponse(`Unknown product: ${tx.productId}`, 400, corsHeaders);
    }
    if (tx.revocationDate) {
      // Refunded or revoked. Not an entitlement, and not an error the member
      // caused — say so plainly rather than 500ing.
      return errorResponse("This purchase has been refunded or revoked", 409, corsHeaders);
    }

    const expiresAt = computeExpiry(tx, meta);

    // Granting a tier must bypass the member's own RLS.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );

    // ── Guard: one Apple subscription, one account ──────────────────────────
    // originalTransactionId is stable across renewals, so this also makes
    // Restore Purchases idempotent for the ORIGINAL buyer (same user_id → fall
    // through and re-grant, which is a no-op write of the same values).
    const { data: claimant, error: claimErr } = await admin
      .from("profiles")
      .select("user_id")
      .eq("apple_original_transaction_id", tx.originalTransactionId)
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (claimant && claimant.user_id !== user.id) {
      return errorResponse(
        "This App Store purchase is already linked to a different Helpr account",
        409,
        corsHeaders,
      );
    }

    // ── Read the member's current state, to avoid a silent downgrade ────────
    const { data: current, error: readErr } = await admin
      .from("profiles")
      .select("subscription_tier, subscription_source, stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) {
      // No profile row for an authenticated user should be impossible, but a
      // blind UPDATE here is precisely how the branch version failed silently.
      console.error("[verify-apple-iap] no profile row for user", user.id);
      return errorResponse("Profile not found", 404, corsHeaders);
    }

    // Cross-platform conflict: they hold a live Stripe subscription AND just
    // bought through Apple. Should have been blocked pre-purchase; if we are
    // here it wasn't. Grant the BETTER of the two so nobody loses access they
    // are paying for, and flag it loudly — a human has to decide the refund,
    // because refunding is a money movement and this is not the seat for it.
    const conflict = !!current.stripe_subscription_id && current.subscription_source === "stripe";
    const grantedTier =
      conflict && tierRank(current.subscription_tier) > tierRank(meta.tier)
        ? current.subscription_tier!
        : meta.tier;

    const { data: updated, error: updateErr } = await admin
      .from("profiles")
      .update({
        subscription_tier: grantedTier,
        subscription_expires_at: expiresAt,
        subscription_billing_cycle: meta.cadence,
        subscription_source: "apple",
        apple_original_transaction_id: tx.originalTransactionId,
      })
      .eq("user_id", user.id)
      // .select() is what turns a zero-row write into something we can SEE.
      // Without it this returns { data: [], error: null } and reads as success
      // — the exact failure that made the branch version take money for
      // nothing. Never remove it from this write.
      .select("user_id");
    if (updateErr) throw updateErr;
    if (!updated || updated.length === 0) {
      console.error("[verify-apple-iap] grant matched ZERO rows for user", user.id);
      return errorResponse("Could not apply your membership — nothing was changed", 500, corsHeaders);
    }

    if (conflict) {
      console.error(
        "[verify-apple-iap] DOUBLE SUBSCRIPTION: user", user.id,
        "bought", meta.tier, "on Apple while holding a live Stripe subscription",
        current.stripe_subscription_id,
      );
      // Best-effort: a failure to notify must not undo a successful grant.
      try {
        await admin.from("fraud_flags").insert({
          user_id: user.id,
          flag_type: "double_subscription",
          details:
            `Bought ${meta.tier} (${meta.cadence}) via Apple while holding Stripe subscription ` +
            `${current.stripe_subscription_id}. Granted ${grantedTier}. Needs a refund decision.`,
        });
      } catch (e) {
        console.error("[verify-apple-iap] could not raise double-subscription flag:", e);
      }
    }

    return jsonResponse(
      { tier: grantedTier, expires_at: expiresAt, billing_cycle: meta.cadence, conflict },
      200,
      corsHeaders,
    );
  } catch (error) {
    console.error("[verify-apple-iap] error:", error);
    return errorResponse("Internal server error", 500, corsHeaders);
  }
});
