import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { PRODUCT_TO_TIER } from "../constants.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { resolveSubscriptionUserId } from "./_resolveUser.ts";

export async function handleCustomerSubscriptionUpdated(
  event: Stripe.Event,
  ctx: WebhookContext,
): Promise<void> {
  const { stripe, supabase, logStep } = ctx;
  const subscription = event.data.object as Stripe.Subscription;

  // Guard before any DB write: only personal tier products may touch
  // subscription_tier. A non-tier product sharing this Stripe customer (a
  // legacy business seat subscription, say) would otherwise wipe or null out
  // the user's personal Pro/Elite tier on every renewal or status change.
  const productId = subscription.items.data[0]?.price.product as string | undefined;
  if (!productId || !PRODUCT_TO_TIER[productId]) {
    logStep("Non-personal subscription updated — skipping profile tier update", { productId, status: subscription.status });
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

  if (subscription.status === "active") {
    const tier = PRODUCT_TO_TIER[productId];
    const expiresAt = new Date(subscription.current_period_end * 1000).toISOString();
    logStep("Subscription updated to active", { email, tier });

    const { data: updatedProfiles, error } = await supabase
      .from("profiles")
      .update({ subscription_tier: tier, subscription_expires_at: expiresAt })
      .eq("user_id", userId)
      .select("user_id");

    if (error) {
      logStep("ERROR updating profile", { error: error.message });
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Subscription renewal — tier not applied after payment captured",
        message: "A customer.subscription.updated event (status=active) fired but the profiles UPDATE (subscription_tier) failed. The subscription renewed but the user may have lost Pro/Elite access. Reconcile manually.",
        fields: {
          email: email ?? "(missing)",
          tier: tier ?? "(missing)",
          subscription_id: subscription.id,
          db_error: error.message,
        },
      });
      // Throw so the outer handler rolls back the idempotency row and returns
      // 500, letting Stripe retry once the DB recovers. A silent return here
      // permanently loses the tier grant — customer paid but gets no access.
      // Matches the error handling in customerSubscriptionDeleted.
      throw new Error(`Failed to apply tier '${tier}' for subscription ${subscription.id}: ${error.message}`);
    } else if (!updatedProfiles || updatedProfiles.length === 0) {
      // UPDATE succeeded but matched 0 rows: the Stripe customer email has no
      // matching profile. Customer paid for renewal but received no entitlement.
      // Unlike checkoutSessionCompleted where client_reference_id provides a
      // user_id fallback, subscription events carry only the Stripe customer
      // email — so retrying won't help; ops must reconcile manually (find the
      // profile by account lookup and apply the tier by hand).
      logStep("WARNING: subscription renewal matched 0 profiles — email mismatch", { email, tier });
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Subscription renewal — tier not applied (no matching profile)",
        message: "A customer.subscription.updated (active) event fired but no profile matched the Stripe customer email. Customer paid for renewal but has no tier access. Reconcile manually.",
        fields: {
          email: email ?? "(missing)",
          tier: tier ?? "(missing)",
          subscription_id: subscription.id,
        },
      });
    } else {
      logStep("Profile updated with tier", { email, tier, expires: expiresAt });
    }
  } else if (["canceled", "unpaid", "past_due", "paused"].includes(subscription.status)) {
    logStep("Subscription inactive", { email, status: subscription.status });

    const { data: clearedProfiles, error } = await supabase
      .from("profiles")
      .update({ subscription_tier: null, subscription_expires_at: null })
      .eq("user_id", userId)
      .select("user_id");

    if (error) {
      logStep("ERROR clearing tier", { error: error.message });
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Subscription cancellation — tier not cleared after status change",
        message: `A customer.subscription.updated event (status=${subscription.status}) fired but the profiles UPDATE (subscription_tier → null) failed. The subscription may have been cancelled/lapsed but the user could retain tier access. Reconcile manually.`,
        fields: {
          email: email ?? "(missing)",
          status: subscription.status,
          subscription_id: subscription.id,
          db_error: error.message,
        },
      });
      // Throw so the outer handler rolls back the idempotency row and returns
      // 500, letting Stripe retry once the DB recovers. Without this, the tier
      // is never cleared and a cancelled/lapsed subscriber retains paid access.
      // Matches the error handling in customerSubscriptionDeleted.
      throw new Error(`Failed to clear tier for subscription ${subscription.id} (status=${subscription.status}): ${error.message}`);
    } else if (!clearedProfiles || clearedProfiles.length === 0) {
      // 0 rows matched — no profile found for this Stripe email. Less critical
      // than the active path (no money loss, just a tier-clear that was a no-op),
      // but worth logging so stale access on a mismatched account is auditable.
      logStep("WARN: subscription status-change matched 0 profiles — email mismatch; tier may persist on another account", {
        email,
        status: subscription.status,
      });
    }
  }
}
