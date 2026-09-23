import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { stripeIdentityVerified } from "../../_shared/stripeIdentity.ts";

export async function handleAccountUpdated(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  const account = event.data.object as Stripe.Account;
  logStep("Connect account updated", { accountId: account.id, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled });

  // Find the helper with this Stripe account
  // Throw rather than drop: this lookup gates caching Stripe's identity
  // verdict. Swallowing the error silently skipped it, leaving a helper who
  // passed Stripe's identity checks unverified with nothing logged and no
  // retry. The 500 path makes Stripe redeliver instead.
  const { data: helperProfile, error: helperProfileError } = await supabase
    .from("profiles")
    .select("user_id, full_name, email_verified, stripe_identity_verified, stripe_charges_enabled, stripe_payouts_enabled")
    .eq("stripe_account_id", account.id)
    .maybeSingle();
  if (helperProfileError) {
    throw new Error(`Helpr lookup failed for account ${account.id}: ${helperProfileError.message}`);
  }

  if (helperProfile) {
    // Cache Stripe's verdict so the profile badge — and, since the award gate
    // (migration 20260827191647), the ability to be hired at all — can be
    // backed by a fact instead of by `idv_status` (an upload/admin state nobody
    // reviews). See _shared/stripeIdentity.ts for why identity is NOT
    // `payouts_enabled`. Doing it here means zero extra Stripe API calls: this
    // event already carries the whole account object.
    //
    // The two raw booleans are cached alongside the verdict because identity
    // verification implies them, so on its own the verdict cannot tell "hasn't
    // set up payouts at all" apart from "Stripe is still verifying you" — and
    // those two blocked helpers need completely different instructions.
    const identityVerified = stripeIdentityVerified(account);
    const chargesEnabled = account.charges_enabled === true;
    const payoutsEnabled = account.payouts_enabled === true;
    if (
      identityVerified !== helperProfile.stripe_identity_verified ||
      chargesEnabled !== helperProfile.stripe_charges_enabled ||
      payoutsEnabled !== helperProfile.stripe_payouts_enabled
    ) {
      const { error: idvErr } = await supabase
        .from("profiles")
        .update({
          stripe_identity_verified: identityVerified,
          stripe_charges_enabled: chargesEnabled,
          stripe_payouts_enabled: payoutsEnabled,
          // Stamp only on the transition INTO verified; clearing leaves the
          // historical timestamp alone rather than pretending it never happened.
          ...(identityVerified ? { stripe_identity_verified_at: new Date().toISOString() } : {}),
        })
        .eq("user_id", helperProfile.user_id);
      if (idvErr) {
        // Still log-don't-throw, even now that this gates hiring: throwing here
        // would also block the payout notice below, and a dropped
        // write fails in the SAFE direction — the columns keep their previous
        // (never over-claiming) values, so the gate stays closed rather than
        // opening. The next account.updated event re-attempts it.
        logStep("⚠️ failed to cache Stripe identity verdict", {
          userId: helperProfile.user_id,
          error: idvErr.message,
        });
      } else {
        logStep("Cached Stripe identity verdict", {
          userId: helperProfile.user_id,
          identityVerified,
          chargesEnabled,
          payoutsEnabled,
        });
      }
    }

    if (account.charges_enabled && account.payouts_enabled) {
      // There used to be an "auto-approve" branch here (email verified +
      // approval_status 'pending' → 'approved' + a "Welcome in." notice). The
      // approval step is retired (Q193/Q205b) and a confirmed email already
      // left nobody 'pending', so only this notice was ever reachable.
      await supabase.from("notifications").insert({
        user_id: helperProfile.user_id,
        title: "Payout account verified",
        message: "Your payout account is fully set up! You can now receive payments for completed jobs.",
        type: "success",
        // Name the tab. Bare "/profile" opens the LANDING tab (resolveTab,
        // src/pages/profile/types.ts), which says nothing about payouts.
        link: "/profile?tab=payment",
      });
      logStep("Helper payout account verified", { userId: helperProfile.user_id, email_verified: helperProfile.email_verified });
    } else if (account.requirements?.currently_due && account.requirements.currently_due.length > 0) {
      await supabase.from("notifications").insert({
        user_id: helperProfile.user_id,
        title: "Payout account needs attention",
        message: "Your payout account requires additional information. Please update your details to continue receiving payments.",
        type: "warning",
        // "Please update your details" has to land ON the details.
        link: "/profile?tab=payment",
      });
      logStep("Helper account needs attention", { userId: helperProfile.user_id, due: account.requirements.currently_due });
    }
  }
}
