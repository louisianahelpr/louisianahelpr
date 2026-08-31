import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { PRODUCT_TO_TIER } from "../constants.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { resolveSubscriptionUserId } from "./_resolveUser.ts";

export async function handleCustomerSubscriptionDeleted(
  event: Stripe.Event,
  ctx: WebhookContext,
): Promise<void> {
  const { stripe, supabase, logStep } = ctx;
  const subscription = event.data.object as Stripe.Subscription;

  // Guard before any DB write: only personal tier products may touch
  // subscription_tier. Anything else — a legacy business seat subscription, or
  // any future non-tier product sharing this Stripe customer — must not clear
  // the user's personal Pro/Elite access on cancellation.
  const productId = subscription.items.data[0]?.price.product as string | undefined;
  if (!productId || !PRODUCT_TO_TIER[productId]) {
    logStep("Non-personal subscription deleted — skipping profile tier clear", { productId });
    return;
  }

  const customerId = subscription.customer as string;
  const customer = await stripe.customers.retrieve(customerId) as Stripe.Customer;
  const email = customer.email;
  // Resolve the account by subscription metadata first, falling back to a
  // UNIQUE email match. A bare .eq("email", ...) could hit zero rows (paying
  // customer silently loses access) or several (wrong account changed).
  const { userId, reason } = await resolveSubscriptionUserId(supabase, subscription, email, logStep);
  if (!userId) {
    logStep("Could not resolve account for subscription — not applying", { email, reason });
    await postSlackOpsAlert({
      kind: "custom",
      severity: "critical",
      title: "Stripe subscription event could not be matched to an account",
      message: "A customer.subscription event fired but no single Helpr profile could be resolved, so the tier change was NOT applied. Reconcile manually.",
      fields: {
        email: email ?? "(missing)",
        subscription_id: subscription.id,
        reason: reason ?? "(unknown)",
      },
    }).catch(() => {});
    return;
  }

  logStep("Subscription deleted", { email });

  const { data: clearedProfiles, error } = await supabase
    .from("profiles")
    .update({ subscription_tier: null, subscription_expires_at: null })
    .eq("user_id", userId)
    .select("user_id");

  if (error) {
    logStep("ERROR clearing tier", { error: error.message });
    // A failed write here leaves the user with Pro/Elite access after
    // their subscription was deleted. There is no retry because we return
    // 200 by default — throw so the outer handler rolls back the idempotency
    // row and returns 500, letting Stripe retry once the DB recovers.
    // Matches the error handling in customerSubscriptionUpdated.
    await postSlackOpsAlert({
      kind: "custom",
      severity: "critical",
      title: "Subscription deletion — tier not cleared",
      message: `A customer.subscription.deleted event fired but the profiles UPDATE (subscription_tier → null) failed. The subscription was deleted in Stripe but the user may still have tier access. Reconcile manually.`,
      fields: {
        email: email ?? "(missing)",
        subscription_id: subscription.id,
        db_error: error.message,
      },
    });
    throw new Error(`Failed to clear tier for deleted subscription ${subscription.id}: ${error.message}`);
  } else if (!clearedProfiles || clearedProfiles.length === 0) {
    // UPDATE succeeded but matched 0 rows — no profile found for this Stripe
    // email. A zero-match on deletion means a formerly-active tier on a
    // mismatched account is never cleared (the subscriber retains access
    // without a valid subscription). Log for auditability; ops can reconcile
    // by finding the profile and nulling its tier.
    logStep("WARN: subscription deleted but matched 0 profiles — email mismatch; stale tier may persist", {
      email,
      subscription_id: subscription.id,
    });
  }
}
