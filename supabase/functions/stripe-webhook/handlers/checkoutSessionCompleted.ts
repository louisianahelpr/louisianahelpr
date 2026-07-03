import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { PRODUCT_TO_TIER, ONE_TIME_PRODUCTS } from "../constants.ts";

export async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const customerEmail = session.customer_email || session.customer_details?.email;
  if (!customerEmail) { logStep("No email on checkout session"); return; }

  let tier: string | null = null;
  let isOneTimePass = false;
  let subscriptionEnd: string | null = null;

  if (session.mode === "subscription") {
    const subscriptionId = session.subscription as string;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const productId = subscription.items.data[0]?.price.product as string;
    tier = PRODUCT_TO_TIER[productId] || null;
    subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();
  } else if (session.mode === "payment") {
    // One-time payment — check session metadata first, then line items
    tier = (session.metadata as any)?.tier || null;
    let matchedProductId: string | null = null;

    if (!tier) {
      try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        const productId = lineItems.data[0]?.price?.product as string;
        if (productId) {
          tier = PRODUCT_TO_TIER[productId] || null;
          matchedProductId = productId;
        }
      } catch (e) {
        logStep("Could not retrieve line items", { error: String(e) });
      }
    }

    // Check if this is a one-time pass product
    if (!matchedProductId && tier) {
      // Try to find the product from line items
      try {
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        matchedProductId = lineItems.data[0]?.price?.product as string || null;
      } catch (_) {}
    }

    if (matchedProductId && ONE_TIME_PRODUCTS.has(matchedProductId)) {
      isOneTimePass = true;
    }

    // Also check billing_cycle metadata from create-pro-checkout
    if ((session.metadata as any)?.billing_cycle === "one_time") {
      isOneTimePass = true;
    }

    if (isOneTimePass) {
      // Set 30-day expiry for one-time passes
      subscriptionEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  logStep("Checkout completed", { email: customerEmail, tier, mode: session.mode, isOneTimePass });

  if (tier) {
    const updateData: any = { subscription_tier: tier };
    if (subscriptionEnd) {
      updateData.subscription_expires_at = subscriptionEnd;
    }

    const { error } = await supabase
      .from("profiles")
      .update(updateData)
      .eq("email", customerEmail);

    if (error) logStep("ERROR updating profile", { error: error.message });
    else logStep("Profile updated with tier", { email: customerEmail, tier, expires: subscriptionEnd });
  }

  // Handle tip checkout completion
  const sessionType = (session.metadata as any)?.type;
  if (sessionType === "tip") {
    const tipJobId = (session.metadata as any)?.job_id;
    const tipperId = (session.metadata as any)?.tipper_id;
    const tipHelperId = (session.metadata as any)?.helper_id;
    if (tipJobId && tipperId) {
      const { error: tipError } = await supabase
        .from("tips")
        .update({ payment_status: "paid" })
        .eq("job_id", tipJobId)
        .eq("tipper_id", tipperId)
        .eq("stripe_session_id", session.id)
        .eq("payment_status", "pending");
      if (tipError) logStep("ERROR updating tip status", { error: tipError.message });
      else logStep("Tip marked as paid", { jobId: tipJobId, tipper: tipperId });

      // Notify the helper about the tip
      if (tipHelperId) {
        await supabase.from("notifications").insert({
          user_id: tipHelperId,
          title: "💰 You received a tip!",
          message: `Someone tipped you for a completed job. Thanks for the great work!`,
          type: "payment",
          link: "/earnings",
        });
      }
    }
  }

  // Handle boost checkout completion — flip the boost flags now
  // that payment captured. Created from create-boost-payment.
  const kind = (session.metadata as any)?.kind;
  if (kind === "job_boost") {
    const boostJobId = (session.metadata as any)?.job_id;
    const durationHours = parseInt((session.metadata as any)?.duration_hours || "24", 10);
    if (boostJobId) {
      const now = new Date();
      const expires = new Date(now.getTime() + durationHours * 60 * 60 * 1000);
      const { error: boostError } = await supabase
        .from("jobs")
        .update({
          boosted_at: now.toISOString(),
          boost_expires_at: expires.toISOString(),
          boost_auto_extended: false,
        })
        .eq("id", boostJobId);
      if (boostError) logStep("ERROR applying boost", { error: boostError.message });
      else logStep("Boost applied", { jobId: boostJobId, expires: expires.toISOString() });
    }
  }

  // Handle paid background-check completion — payment captured, so kick
  // off the screening through the existing verification engine. The
  // helper's public badge flips to "verified" via the
  // sync_credential_from_check() trigger once the vendor/admin marks the
  // check passed. Created from create-bgc-payment.
  if (kind === "background_check") {
    const bgcUserId = (session.metadata as any)?.user_id;
    if (!bgcUserId) {
      logStep("WARNING: background_check checkout with no user_id");
    } else {
      // Mark the public profile flag as pending so the helper (and
      // viewers) see "in progress" immediately after payment.
      const { error: pendErr } = await supabase
        .from("profiles")
        .update({ background_check_status: "pending" })
        .eq("user_id", bgcUserId);
      if (pendErr) logStep("ERROR setting bgc pending", { error: pendErr.message });

      // Record the credential attempt + a check run for the admin queue.
      const { data: cred, error: credErr } = await supabase
        .from("helper_credentials")
        .insert({
          user_id: bgcUserId,
          credential_type: "background_check",
          status: "submitted",
        })
        .select("id")
        .single();
      if (credErr) {
        logStep("ERROR creating bgc credential", { error: credErr.message });
      } else if (cred) {
        const { error: checkErr } = await supabase
          .from("verification_checks")
          .insert({
            credential_id: cred.id,
            user_id: bgcUserId,
            vendor: "manual",
            check_type: "background",
            status: "initiated",
          });
        if (checkErr) logStep("ERROR creating bgc check", { error: checkErr.message });
      }

      await supabase.from("notifications").insert({
        user_id: bgcUserId,
        title: "🛡️ Background check started",
        message:
          "Thanks — your payment went through and your background check is in progress. We'll add your Background-Checked badge as soon as it clears.",
        type: "success",
        link: "/profile",
      });
      logStep("Background check initiated", { userId: bgcUserId });
    }
  }

  // Store payment intent ID on the job.
  // Skip for tip and job_boost checkouts — they embed job_id in metadata
  // for their own handlers above, but their Stripe payment intents must NOT
  // overwrite the job's escrow PI or flip payment_status to "escrow".
  const jobId = (session.metadata as any)?.job_id;
  const piId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : (session.payment_intent as any)?.id;

  if (jobId && piId && sessionType !== "tip" && kind !== "job_boost") {
    const isRepay = (session.metadata as any)?.repay === "true";
    const updateData: any = {
      stripe_payment_intent_id: piId,
      payment_status: "escrow", // Mark as escrow only after confirmed checkout
    };

    if (isRepay) {
      updateData.payment_status = "payout_pending";
      updateData.payout_scheduled_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      logStep("Re-payment completed, scheduling payout", { jobId, pi: piId });
    }

    const { error: jobError } = await supabase.from("jobs").update(updateData).eq("id", jobId);
    if (jobError) logStep("ERROR storing PI on job", { error: jobError.message });
    else logStep("Stored payment_intent and escrow status on job", { jobId, pi: piId, repay: isRepay });

    // Mark poster's onboarding fee paid if it was charged on this session.
    //
    // Race protection: two checkouts opened in parallel can each carry
    // the $2 fee in their line items if both were generated before the
    // first one's webhook fired. The atomic UPDATE below only flips
    // the flag if it was still false at write time. If the WHERE
    // clause matches (1 row updated), this checkout was the first
    // and the charge is legitimate. If it doesn't match (0 rows),
    // another path already collected the fee — refund this $2.
    if ((session.metadata as any)?.onboarding_fee_charged === "true") {
      const posterId = (session.metadata as any)?.customer_id;
      if (posterId) {
        const { data: flipped, error: feeErr } = await supabase
          .from("profiles")
          .update({ onboarding_fee_paid: true, onboarding_fee_charged_at: new Date().toISOString() })
          .eq("user_id", posterId)
          .eq("onboarding_fee_paid", false)
          .select("user_id");

        if (feeErr) {
          logStep("ERROR atomic flip onboarding fee", { error: feeErr.message });
        } else if (flipped && flipped.length > 0) {
          logStep("Onboarding fee marked paid for poster", { posterId });
        } else {
          // Flag was already true — duplicate fee charged. Auto-refund $2.
          // Stripe idempotency key keyed on session.id so webhook
          // re-deliveries don't create multiple refunds for the same
          // duplicate charge.
          try {
            const ONBOARDING_FEE_CENTS = 200;
            const refund = await stripe.refunds.create(
              {
                payment_intent: piId,
                amount: ONBOARDING_FEE_CENTS,
                reason: "requested_by_customer",
                metadata: {
                  reason: "duplicate_onboarding_fee",
                  session_id: session.id,
                  user_id: posterId,
                },
              },
              { idempotencyKey: `dup-onboarding-fee-${session.id}` },
            );
            await supabase.from("notifications").insert({
              user_id: posterId,
              type: "payment",
              title: "💸 Duplicate fee refunded",
              message:
                "We caught a duplicate $2 onboarding fee on your account and refunded it. The fee is one-time only — you won't see it again.",
              link: "/profile",
              read: false,
            });
            logStep("Refunded duplicate onboarding fee", {
              posterId,
              sessionId: session.id,
              refundId: refund.id,
            });
          } catch (refundErr) {
            logStep("ERROR refunding duplicate onboarding fee", {
              error: (refundErr as Error).message,
              posterId,
              sessionId: session.id,
            });
          }
        }
      }
    }
  } else if (jobId) {
    logStep("WARNING: checkout completed for job but no payment_intent on session", { jobId });
  }
}
