import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { grantedTierForSeatSubscription } from "../../_shared/seatTierGrant.ts";

/**
 * Apply (or revoke) the commission discount a business seat plan pays for,
 * directly from a Stripe customer.subscription.* event.
 *
 * WHY THIS RUNS IN THE WEBHOOK. The seat plan's headline benefit is a lower
 * commission (Crew 11% / Team 10% / Enterprise 8% vs the standard 12%). That
 * benefit used to be applied ONLY by check-business-seat-subscription, whose
 * only caller was a React page — so the discount landed when the customer
 * happened to open a business page in the app, not when they paid. An owner who
 * worked from the normal dashboard kept being charged 12% while paying $20/mo
 * for 11%, with no error anywhere. Cancellation had the mirror bug: the
 * discount persisted until their next visit.
 *
 * Driving it from the subscription event means it lands the moment the payment
 * clears and is removed the moment the plan lapses, with no app visit at all.
 * check-business-seat-subscription remains as a reconciliation path.
 *
 * Returns true if this event WAS a business seat subscription (and has been
 * fully handled here), so the caller can stop rather than fall through to the
 * personal-tier logic.
 *
 * ⚠️ Inherited side effect, unchanged from the poll it mirrors: the grant is
 * written to profiles.subscription_tier, the same column personal Pro/Elite
 * uses. An owner holding BOTH a personal membership and a seat plan will have
 * whichever event fired last win. That collision predates this change; it is
 * called out here because this code makes the seat side fire far more often.
 */
export async function applyBusinessSeatGrant(
  subscription: Stripe.Subscription,
  { supabase, logStep }: WebhookContext,
): Promise<boolean> {
  const meta = (subscription.metadata || {}) as Record<string, string>;
  if (meta.kind !== "business_seats") return false;

  const businessId = meta.business_id;
  if (!businessId) {
    logStep("Business seat subscription with no business_id — cannot grant", {
      subscription_id: subscription.id,
    });
    await postSlackOpsAlert({
      kind: "custom",
      severity: "critical",
      title: "Business seat subscription missing business_id",
      message:
        "A customer.subscription.* event was tagged kind=business_seats but carried no business_id, so the commission discount could not be applied or revoked. The customer may be paying for a rate they are not receiving.",
      fields: { subscription_id: subscription.id, status: subscription.status },
    });
    return true;
  }

  const productId = subscription.items.data[0]?.price.product as string | undefined;
  const grantedTier = grantedTierForSeatSubscription(productId, subscription.status);

  // Resolve the OWNER — the seat plan is billed to them, and team members are
  // deliberately not granted.
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("owner_id")
    .eq("id", businessId)
    .maybeSingle();

  if (businessError) {
    // Throw so the webhook's 500 path rolls back the dedupe row and Stripe
    // redelivers — silently skipping would leave the customer on the wrong rate.
    throw new Error(
      `business lookup failed for seat subscription ${subscription.id} (business ${businessId}): ${businessError.message}`,
    );
  }
  if (!business?.owner_id) {
    logStep("Business seat subscription for unknown business — skipping", { businessId });
    return true;
  }

  const { error: grantError } = await supabase
    .from("profiles")
    .update({ subscription_tier: grantedTier })
    .eq("user_id", business.owner_id);

  if (grantError) {
    throw new Error(
      `seat tier grant failed for owner ${business.owner_id} (business ${businessId}): ${grantError.message}`,
    );
  }

  // Keep the businesses row's cached status in step, so the reconciliation poll
  // and any UI reading seat_subscription_status agree with what just happened.
  const { error: bizSyncError } = await supabase
    .from("businesses")
    .update({ seat_subscription_status: subscription.status })
    .eq("id", businessId);
  if (bizSyncError) {
    // Non-fatal: the money-relevant grant above already succeeded. Log rather
    // than throw, so a cosmetic status write can't trigger an endless retry of
    // an event whose important half is done.
    logStep("Seat subscription status sync failed (grant already applied)", {
      businessId,
      error: bizSyncError.message,
    });
  }

  logStep("Business seat grant applied", {
    businessId,
    ownerId: business.owner_id,
    status: subscription.status,
    grantedTier: grantedTier ?? "(revoked to standard rate)",
  });
  return true;
}
