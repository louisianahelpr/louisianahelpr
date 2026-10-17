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
// later renewal can still find the member it belongs to. Because it is never
// cleared, finding the row is not enough: the row must still say Apple is its
// authority (subscription_source 'apple'), and a Sandbox transaction counts
// only for a test account. Either failing leaves the row untouched.

import { serve } from "../_shared/buildStamp.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import {
  computeExpiry,
  decodeJwsPayload,
  environmentVerdict,
  fetchAppleTransaction,
  fetchLatestSubscriptionTransaction,
  isEntitled,
  membershipsSwitchFor,
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

    const postedTx = await fetchAppleTransaction(posted.transactionId);
    const postedMeta = resolveProduct(postedTx.productId);
    if (!postedMeta) {
      console.error(`[assn] unknown product ${postedTx.productId} — not one of ours`);
      return ack("unknown_product", { productId: postedTx.productId });
    }

    // ── Grade the subscription as it stands NOW, not the posted transaction ──
    // (Q1860) Apple retries a failed notice for up to three days, and anyone can
    // POST an older transaction id of the same subscription. Either carries a
    // past expiresDate, and grading it cleared the tier of a member who has
    // since renewed. For an auto-renewable product, the subscription's LATEST
    // transaction (App Store Server API, by originalTransactionId) decides; an
    // Apple read failure throws to the 500 below, so nothing is written and
    // Apple retries. A one-time pass has no later transaction to read.
    const tx = postedMeta.kind === "auto"
      ? await fetchLatestSubscriptionTransaction(postedTx)
      : postedTx;
    const meta = tx === postedTx ? postedMeta : resolveProduct(tx.productId);
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
      .select("user_id, subscription_tier, subscription_source, subscription_expires_at, stripe_subscription_id")
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

    // ── The App Store environment must count for this account ────────────────
    // A Sandbox purchase is free. verify-apple-iap grants one only to a test
    // account (Q1794), and a renewal or refund notice is held to the same
    // rule: in a production deployment a Sandbox transaction changes nothing
    // on a real member's row, whatever the notification says. Checked FIRST,
    // so a Sandbox notice can never reclaim a row either (below).
    const verdict = await environmentVerdict(tx, admin, profile.user_id);
    if (verdict === "unknown") {
      // The test-account read failed: not "ignored for good". 500, so Apple
      // retries (lh-money-escrow re-review of 18f0d5fb3, finding 5).
      console.error(`[assn] ${notificationType}: test-account status for ${profile.user_id} unreadable; Apple will retry`);
      return jsonResponse({ ok: false, outcome: "environment_unknown" }, 500, corsHeaders);
    }
    if (verdict === "does_not_count") {
      console.error(
        `[assn] ${notificationType}: SANDBOX transaction ${tx.transactionId} for ` +
          `non-test account ${profile.user_id} in production; ignored`,
      );
      return ack("sandbox_ignored", { notificationType });
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

    // ── Apple must still be the authority for this row ──────────────────────
    // apple_original_transaction_id is never cleared (see the header), so it
    // still finds a FORMER Apple member who has since subscribed on the web.
    // stripe-webhook and check-pro-subscription stamp subscription_source
    // 'stripe' on that grant, and from then on Stripe decides their tier.
    // Without this check a late EXPIRED / REFUND for the old Apple
    // subscription nulled the tier they pay Stripe for, and a late DID_RENEW
    // overwrote it with the Apple tier.
    //
    // One exception, so nobody pays Apple for nothing (lh-money-escrow review
    // of 3b12e17b4, finding 1): when Apple says this subscription IS paid and
    // Stripe holds nothing on the row any more (no subscription id, no tier
    // still running), Apple takes the row back. That is the member whose
    // double subscription was settled by cancelling the Stripe side.
    if (profile.subscription_source !== "apple") {
      const expiresMs = profile.subscription_expires_at ? Date.parse(profile.subscription_expires_at) : null;
      const stripeHoldsIt = !!profile.stripe_subscription_id ||
        (!!profile.subscription_tier && (expiresMs === null || expiresMs > Date.now()));
      if (!entitled || stripeHoldsIt) {
        console.error(
          `[assn] ${notificationType}: user ${profile.user_id} is billed by ` +
            `${profile.subscription_source ?? "nobody"}, not Apple; tier left alone`,
        );
        if (entitled) {
          // A member Apple is charging while Stripe holds their row: a double
          // subscription a human must settle. Never let the alert fail the ack.
          //
          // Q1859: worded by the arm that matched (only a live Stripe
          // subscription id is certainly "paying twice"; a Stripe tier with no
          // subscription behind it is a one-time pass or a tier with no end
          // date), and posted once per day per member and subscription,
          // because this endpoint is unauthenticated and a replayed POST of a
          // real transaction id must not page ops once per request.
          const message = profile.stripe_subscription_id
            ? "An App Store notice says this member's Apple subscription is paid, but a live Stripe subscription bills their row, so the notice changed nothing. They are paying twice: settle which subscription to keep and refund the other."
            : "An App Store notice says this member's Apple subscription is paid, but their row holds a Stripe-granted tier with no Stripe subscription behind it (a one-time pass, or a tier with no end date), so the notice changed nothing. Check what the Stripe tier was paid with before refunding either side; the member can tap Restore Purchases once the Stripe tier ends.";
          try {
            await postSlackOpsAlert({
              kind: "custom",
              severity: "warning",
              title: "Apple is billing a member whose tier Stripe holds",
              message,
              fields: { user_id: profile.user_id, notification: notificationType, product: tx.productId },
              oncePerDayKey: `apple-double-billing:${profile.user_id}:${tx.originalTransactionId}`,
            });
          } catch (e) {
            console.error("[assn] ops alert failed:", caughtMessage(e));
          }
        }
        // The billing system is not echoed: this endpoint is unauthenticated
        // (finding 6 of the same review).
        return ack("not_apple_authority", { notificationType });
      }
      console.warn(
        `[assn] ${notificationType}: Apple reclaims user ${profile.user_id} ` +
          `(was ${profile.subscription_source ?? "nobody"}, Stripe holds nothing)`,
      );
    }

    // An 'apple' row that ALSO carries a live Stripe subscription (verify-apple-iap's
    // double-subscription branch) is paid by Stripe too: an Apple refund or
    // expiry must not null the tier Stripe is charging for (re-review finding 2).
    if (!entitled && profile.subscription_source === "apple" && profile.stripe_subscription_id) {
      console.error(
        `[assn] ${notificationType}: Apple ended user ${profile.user_id}'s subscription but a Stripe subscription still bills them; tier left alone`,
      );
      return ack("stripe_still_billing", { notificationType });
    }

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

    // The write repeats the state the decision was made on (re-review finding
    // 1): a Stripe checkout landing between the read and this write makes it
    // match zero rows, and the 500 below makes Apple retry against the new row.
    let write = admin
      .from("profiles")
      .update(patch)
      .eq("user_id", profile.user_id);
    write = profile.subscription_source === null
      ? write.is("subscription_source", null)
      : write.eq("subscription_source", profile.subscription_source);
    write = profile.stripe_subscription_id === null
      ? write.is("stripe_subscription_id", null)
      : write.eq("stripe_subscription_id", profile.stripe_subscription_id);
    const { data: updated, error: updateErr } = await write
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

    // Q1849: Apple charged without asking our purchase gate (auto-renewal,
    // iOS Settings, an offer code). The grant above stands (never refuse after
    // Apple took the money); a member the memberships switch is off for is
    // reported so a human refunds them. Never fails the ack.
    if (entitled) {
      const membershipsSwitch = await membershipsSwitchFor(admin, profile.user_id);
      if (membershipsSwitch !== "on") {
        try {
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "warning",
            title: "Apple charged a member for a membership that is switched off",
            message: membershipsSwitch === "off"
              ? "An App Store notice granted a membership to someone the memberships switch is off for, so they are paying Apple for perks that are off. The grant was kept (Apple already charged). Refund them in App Store Connect or tell them how to cancel."
              : "An App Store notice granted a membership, but whether the memberships switch is on for this member could not be read. The grant was kept (Apple already charged). Check the switch for this member; if it is off, refund them.",
            fields: { user_id: profile.user_id, notification: notificationType, product: tx.productId },
            oncePerDayKey: `apple-memberships-off:${profile.user_id}:${tx.originalTransactionId}`,
          });
        } catch (e) {
          console.error("[assn] memberships-off alert failed:", caughtMessage(e));
        }
      }
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
