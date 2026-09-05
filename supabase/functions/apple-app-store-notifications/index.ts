// App Store Server Notifications V2 — renewals, lapses, refunds, revocations.
//
// Without this, an Apple membership is granted once by verify-apple-iap and
// then never changes again: it does not renew, does not lapse, and survives a
// refund. That is the difference between a subscription and a one-off grant.
//
// ── The trust model ─────────────────────────────────────────────────────────
//
// This endpoint runs with verify_jwt = false, because Apple cannot present a
// Supabase JWT. So the request is UNAUTHENTICATED and anyone on the internet
// can POST to it. We therefore trust NOTHING in the body beyond a transaction
// id, and re-pull the authoritative transaction from the App Store Server API
// over TLS — the same trust boundary verify-apple-iap uses. A forged
// notification can, at most, make us re-read a real transaction from Apple and
// re-apply what Apple already says is true.
//
// This is why the signed payload is decoded but its signature is NOT relied on
// for authorisation. Decoding gives us the transaction id to look up; the
// lookup is what grants anything.
//
// ── Why it finds the buyer by originalTransactionId ─────────────────────────
//
// A notification carries no user identity at all. Apple's originalTransactionId
// is the stable identity of a subscription across every renewal, and
// profiles.apple_original_transaction_id is stamped with it at purchase and
// deliberately never cleared — including when a tier lapses — precisely so a
// later renewal can still find the member it belongs to.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  computeExpiry,
  decodeJwsPayload,
  fetchAppleTransaction,
  isEntitled,
  resolveProduct,
} from "../_shared/appleAppStore.ts";

/** The envelope Apple POSTs. Only `signedPayload` matters to us. */
interface AssnBody {
  signedPayload?: string;
}

/** The decoded notification. We read the type and dig out a transaction id. */
interface AssnPayload {
  notificationType?: string;
  subtype?: string;
  data?: {
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // ALWAYS 200 on anything we understood well enough to not want retried.
  // Apple retries a non-2xx for up to three days with increasing backoff, so a
  // 500 on a notification we can never process (an unknown product, a
  // transaction for a deleted account) becomes days of noise. We return 200
  // with a body saying what happened, and log loudly instead.
  const ack = (outcome: string, extra: Record<string, unknown> = {}) =>
    jsonResponse({ ok: true, outcome, ...extra }, 200, corsHeaders);

  try {
    const body = (await req.json()) as AssnBody;
    if (!body?.signedPayload) {
      console.error("[assn] no signedPayload in body");
      return ack("no_signed_payload");
    }

    const payload = decodeJwsPayload<AssnPayload>(body.signedPayload);
    const notificationType = payload.notificationType ?? "UNKNOWN";
    const subtype = payload.subtype ?? "";

    if (!payload.data?.signedTransactionInfo) {
      // CONSUMPTION_REQUEST and some test notifications carry no transaction.
      console.log(`[assn] ${notificationType}/${subtype} carried no transaction info`);
      return ack("no_transaction_info", { notificationType });
    }

    // Read ONLY the id out of the posted payload. Everything that decides
    // entitlement comes from the authoritative re-fetch below.
    const posted = decodeJwsPayload<{ transactionId?: string }>(
      payload.data.signedTransactionInfo,
    );
    if (!posted.transactionId) {
      console.error("[assn] posted transaction had no transactionId");
      return ack("no_transaction_id", { notificationType });
    }

    const tx = await fetchAppleTransaction(posted.transactionId);
    const meta = resolveProduct(tx.productId);
    if (!meta) {
      console.error(`[assn] unknown product ${tx.productId} — not one of ours`);
      return ack("unknown_product", { productId: tx.productId });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
    );

    // The only link back to a person.
    const { data: profile, error: findErr } = await admin
      .from("profiles")
      .select("user_id, subscription_tier, subscription_source")
      .eq("apple_original_transaction_id", tx.originalTransactionId)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!profile) {
      // Genuinely possible and not an error: a purchase whose verify call never
      // completed, or an account since deleted. Nothing to do, and retrying
      // will not conjure a profile — so acknowledge rather than make Apple
      // redeliver for three days.
      console.error(
        `[assn] ${notificationType}: no profile for originalTransactionId ${tx.originalTransactionId}`,
      );
      return ack("no_linked_profile", { notificationType });
    }

    // Entitled or not, decided from Apple's own transaction rather than from
    // the notification type. The types are many and overlapping (DID_RENEW,
    // EXPIRED, GRACE_PERIOD_EXPIRED, REFUND, REVOKE, DID_CHANGE_RENEWAL_STATUS
    // …) and mapping each to an outcome is a long list that rots. The
    // transaction already says whether it is revoked and when it expires, so
    // ask it. A grace period shows up as an expiresDate still in the future,
    // which is exactly the behaviour we want: keep access while Apple retries.
    const entitled = isEntitled(tx, meta);
    const expiresAt = computeExpiry(tx, meta);

    const patch = entitled
      ? {
          subscription_tier: meta.tier,
          subscription_expires_at: expiresAt,
          subscription_billing_cycle: meta.cadence,
          subscription_source: "apple",
        }
      : {
          subscription_tier: null,
          subscription_expires_at: expiresAt,
          subscription_billing_cycle: null,
          // subscription_source stays 'apple': it records who the authority IS,
          // not whether they currently owe us anything. Clearing it would hand
          // this row back to the Stripe reconciler, which has no business
          // grading it.
          subscription_source: "apple",
        };

    const { data: updated, error: updateErr } = await admin
      .from("profiles")
      .update(patch)
      .eq("user_id", profile.user_id)
      // A zero-row UPDATE returns { data: [], error: null }. Without this, a
      // refund that silently failed to revoke would look exactly like a refund
      // that worked. Never remove it.
      .select("user_id");
    if (updateErr) throw updateErr;
    if (!updated || updated.length === 0) {
      console.error(`[assn] ${notificationType}: update matched ZERO rows for ${profile.user_id}`);
      // This one IS worth a retry — the row existed a moment ago.
      return jsonResponse({ ok: false, outcome: "zero_row_update" }, 500, corsHeaders);
    }

    console.log(
      `[assn] ${notificationType}/${subtype} → user ${profile.user_id}: ` +
        `${entitled ? `tier ${meta.tier} until ${expiresAt}` : "tier cleared"}`,
    );
    return ack(entitled ? "granted" : "revoked", {
      notificationType,
      subtype,
      tier: entitled ? meta.tier : null,
    });
  } catch (error) {
    // A genuine failure — Apple unreachable, our key wrong, the DB down. Let
    // Apple retry this one.
    console.error("[assn] error:", error);
    return jsonResponse({ ok: false, error: "Internal server error" }, 500, corsHeaders);
  }
});
