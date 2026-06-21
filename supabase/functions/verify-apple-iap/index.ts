// Verify an Apple In-App Purchase and grant the corresponding subscription tier.
//
// Called by the native iOS client immediately after a successful StoreKit 2
// purchase. The client sends ONLY a transactionId — we re-fetch the
// authoritative transaction from Apple's App Store Server API (see
// _shared/appleAppStore.ts) so a tampered client can't grant itself a tier.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import {
  computeExpiry,
  fetchAppleTransaction,
  resolveProduct,
} from "../_shared/appleAppStore.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Authenticate the caller with their own JWT (anon client + bearer token).
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Missing authorization header", 401, corsHeaders);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData } = await authClient.auth.getUser(token);
    const user = userData.user;
    if (!user) return errorResponse("User not authenticated", 401, corsHeaders);

    const { transactionId } = await req.json();
    if (!transactionId || typeof transactionId !== "string") {
      return errorResponse("transactionId is required", 400, corsHeaders);
    }

    // Authoritative pull from Apple — this is the trust boundary.
    const tx = await fetchAppleTransaction(transactionId);
    const meta = resolveProduct(tx.productId);
    if (!meta) {
      return errorResponse(`Unknown product: ${tx.productId}`, 400, corsHeaders);
    }
    if (tx.revocationDate) {
      return errorResponse("Transaction has been revoked", 409, corsHeaders);
    }

    const expiresAt = computeExpiry(tx, meta);

    // Service-role write: granting a tier must bypass the user's own RLS.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );

    // Guard against one Apple subscription being claimed by two accounts.
    const { data: existing, error: existingErr } = await admin
      .from("profiles")
      .select("id")
      .eq("apple_original_transaction_id", tx.originalTransactionId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing && existing.id !== user.id) {
      return errorResponse("This purchase is linked to a different account", 409, corsHeaders);
    }

    const { error: updateErr } = await admin
      .from("profiles")
      .update({
        subscription_tier: meta.tier,
        subscription_expires_at: expiresAt,
        apple_original_transaction_id: tx.originalTransactionId,
      })
      .eq("id", user.id);
    if (updateErr) throw updateErr;

    return jsonResponse(
      { tier: meta.tier, expires_at: expiresAt },
      200,
      corsHeaders,
    );
  } catch (error) {
    console.error("[verify-apple-iap] error:", error);
    return errorResponse("Internal server error", 500, corsHeaders);
  }
});
