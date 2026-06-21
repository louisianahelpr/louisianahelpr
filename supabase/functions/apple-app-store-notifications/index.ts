// App Store Server Notifications v2 webhook.
//
// Apple POSTs subscription lifecycle events here (renewals, expirations,
// refunds, revocations). The body is { signedPayload: <JWS> } and carries NO
// user identity — only a transaction. We:
//   1. decode the notification to learn which transaction it concerns,
//   2. re-fetch the AUTHORITATIVE transaction from Apple's App Store Server API
//      (so a forged POST to this open endpoint can't grant anyone a tier — the
//      grant always reflects Apple's own record), and
//   3. update the profile we previously linked via apple_original_transaction_id.
//
// Registered in config.toml with verify_jwt = false (Apple can't send a
// Supabase JWT). Set the webhook URL in App Store Connect → App Information →
// App Store Server Notifications (Version 2).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import {
  computeExpiry,
  decodeJwsPayload,
  fetchAppleTransaction,
  resolveProduct,
} from "../_shared/appleAppStore.ts";

interface NotificationPayload {
  notificationType: string;
  subtype?: string;
  data?: {
    signedTransactionInfo?: string;
    bundleId?: string;
  };
}

interface InnerTransaction {
  transactionId: string;
  originalTransactionId: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const signedPayload: string | undefined = body?.signedPayload;
    if (!signedPayload) return errorResponse("Missing signedPayload", 400, corsHeaders);

    const notification = decodeJwsPayload<NotificationPayload>(signedPayload);
    const signedTx = notification.data?.signedTransactionInfo;
    if (!signedTx) {
      // Some notification types (e.g. RENEWAL_EXTENSION on a whole app) carry no
      // transaction — nothing to reconcile. Ack so Apple stops retrying.
      return jsonResponse({ ok: true, skipped: notification.notificationType }, 200, corsHeaders);
    }

    const claimed = decodeJwsPayload<InnerTransaction>(signedTx);

    // Re-pull the authoritative record — never trust the posted payload itself.
    const tx = await fetchAppleTransaction(claimed.transactionId);
    const meta = resolveProduct(tx.productId);
    if (!meta) {
      return jsonResponse({ ok: true, skipped: `unknown product ${tx.productId}` }, 200, corsHeaders);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );

    // Find the user we linked at first purchase.
    const { data: profile, error: lookupErr } = await admin
      .from("profiles")
      .select("id")
      .eq("apple_original_transaction_id", tx.originalTransactionId)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!profile) {
      // No linked user yet (e.g. event raced ahead of verify-apple-iap). Ack;
      // the client-side verify call will establish the link.
      return jsonResponse({ ok: true, unlinked: tx.originalTransactionId }, 200, corsHeaders);
    }

    // Refund / revoke → drop the tier entirely. Otherwise reflect Apple's
    // current expiry (a past date naturally gates the user out).
    const revoked = !!tx.revocationDate;
    const expiresAt = revoked ? null : computeExpiry(tx, meta);
    const { error: updateErr } = await admin
      .from("profiles")
      .update({
        subscription_tier: revoked ? null : meta.tier,
        subscription_expires_at: expiresAt,
      })
      .eq("id", profile.id);
    if (updateErr) throw updateErr;

    return jsonResponse(
      { ok: true, type: notification.notificationType, revoked },
      200,
      corsHeaders,
    );
  } catch (error) {
    console.error("[apple-app-store-notifications] error:", error);
    // 500 makes Apple retry, which is what we want on a transient failure.
    return errorResponse("Internal server error", 500, corsHeaders);
  }
});
