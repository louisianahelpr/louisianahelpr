import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { stripeIdentityVerified } from "../../_shared/stripeIdentity.ts";
import { insertNotifications } from "../../_shared/insertNotifications.ts";
import { isUnusableConnectAccountError } from "../../_shared/stripeAccountUsable.ts";

const NEEDS_ATTENTION_TITLE = "Payout account needs attention";

export async function handleAccountUpdated(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const accountId = (event.data.object as Stripe.Account).id;

  // Find the helper with this Stripe account.
  // Throw rather than drop: this lookup gates caching Stripe's identity
  // verdict. Swallowing the error silently skipped it, leaving a helper who
  // passed Stripe's identity checks unverified with nothing logged and no
  // retry. The 500 path makes Stripe redeliver instead.
  //
  // Q869 ordering: this snapshot is read BEFORE the retrieve below, on
  // purpose. The compare-and-set further down is only sound if what it
  // compares against predates the Stripe state it is about to write: then any
  // write that lands between this read and ours changes the row and our CAS
  // loses. Read after the retrieve, an older retrieve could pick up a newer
  // writer's values as its own baseline and overwrite them.
  const { data: helperProfile, error: helperProfileError } = await supabase
    .from("profiles")
    .select("user_id, full_name, email_verified, stripe_identity_verified, stripe_charges_enabled, stripe_payouts_enabled")
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  if (helperProfileError) {
    throw new Error(`Helpr lookup failed for account ${accountId}: ${helperProfileError.message}`);
  }
  if (!helperProfile) {
    logStep("Skipped account.updated: no profile links this account", { accountId });
    return;
  }

  // Q869 — the event payload is a SNAPSHOT from when Stripe generated it, and
  // Stripe delivers late and out of order. Caching it as-is let an older
  // `payouts_enabled=true` event, delivered after a newer restricted one for
  // the same account, re-open the payout/hiring gate. So the payload is used
  // for its account id only; every flag below comes from the account as
  // Stripe holds it NOW, so whichever event arrives, it caches current truth.
  let account: Stripe.Account;
  try {
    account = await stripe.accounts.retrieve(accountId);
  } catch (err) {
    if (isUnusableConnectAccountError(err)) {
      // The account is gone (deleted by a reset, or a test-mode purge). There
      // is no current state to cache and a retry would get the same answer,
      // so acknowledge. Clearing the LINK to a dead account stays
      // stripe-connect's job (Q859), scoped to its caller.
      //
      // Q875 (decided 2026-10-02): but the cached GATE closes here. A dead
      // account can take no payouts, so a profile still linked to it must not
      // keep showing the verified badge or pass the hiring gate on flags
      // cached while it was alive. Only the three flags move, only towards
      // false (the safe direction), scoped to this user AND this account id
      // so a concurrent re-onboard onto a new account is never touched. Zero
      // rows is legitimate (the link already moved on); an error throws so
      // Stripe redelivers.
      const { data: closedRows, error: closeErr } = await supabase
        .from("profiles")
        .update({
          stripe_identity_verified: false,
          stripe_charges_enabled: false,
          stripe_payouts_enabled: false,
        })
        .eq("user_id", helperProfile.user_id)
        .eq("stripe_account_id", accountId)
        .select("id");
      if (closeErr) {
        throw new Error(`Could not close the cached payout gate for dead account ${accountId}: ${closeErr.message}`);
      }
      logStep("Skipped account.updated: account no longer retrievable; cached gate closed", {
        accountId,
        rows: closedRows?.length ?? 0,
      });
      return;
    }
    // Anything else (network, rate limit, auth): throw so the webhook answers
    // 500 and Stripe redelivers, rather than falling back to the stale payload.
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not retrieve Connect account ${accountId}: ${reason}`);
  }
  logStep("Connect account updated", { accountId: account.id, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled });

  // Cache Stripe's verdict so the profile badge — and, since the award gate
  // (migration 20260827191647), the ability to be hired at all — can be
  // backed by a fact instead of by `idv_status` (an upload/admin state nobody
  // reviews). See _shared/stripeIdentity.ts for why identity is NOT
  // `payouts_enabled`.
  //
  // The two raw booleans are cached alongside the verdict because identity
  // verification implies them, so on its own the verdict cannot tell "hasn't
  // set up payouts at all" apart from "Stripe is still verifying you" — and
  // those two blocked helpers need completely different instructions.
  const identityVerified = stripeIdentityVerified(account);
  const chargesEnabled = account.charges_enabled === true;
  const payoutsEnabled = account.payouts_enabled === true;
  const nowEnabled = chargesEnabled && payoutsEnabled;
  // Q870 — was the account already fully enabled BEFORE this event? The
  // "verified" notice below goes out only on the transition into enabled,
  // never again on each later account.updated for an enabled helper.
  const wasEnabled =
    helperProfile.stripe_charges_enabled === true && helperProfile.stripe_payouts_enabled === true;
  let becameEnabled = false;
  if (
    identityVerified !== helperProfile.stripe_identity_verified ||
    chargesEnabled !== helperProfile.stripe_charges_enabled ||
    payoutsEnabled !== helperProfile.stripe_payouts_enabled
  ) {
    // Scoped to the account id this EVENT is about, not just the user (Q866).
    // The lookup above matched on it, but Stripe delivers late and out of
    // order: between that read and this write a reset, a Q859 clear or a
    // re-onboard can null or replace the id, and a user_id-only write would
    // then stamp the old account's payouts_enabled=true onto a profile that
    // now points at another account or none. `.select("id")` reads it back.
    //
    // And a compare-and-set on the three values read above (all NOT NULL
    // booleans on prod, measured 2026-09-30 in information_schema): Stripe
    // sends account.updated in bursts, and two deliveries that both read
    // "not enabled" must not both win the transition (two notices), nor may
    // one whose snapshot predates a newer write overwrite it (Q869): the
    // snapshot is read before the retrieve, so a newer write always changes
    // the row out from under an older delivery's CAS.
    const { data: idvRows, error: idvErr } = await supabase
      .from("profiles")
      .update({
        stripe_identity_verified: identityVerified,
        stripe_charges_enabled: chargesEnabled,
        stripe_payouts_enabled: payoutsEnabled,
        // Stamp only on the transition INTO verified; clearing leaves the
        // historical timestamp alone rather than pretending it never happened.
        ...(identityVerified ? { stripe_identity_verified_at: new Date().toISOString() } : {}),
      })
      .eq("user_id", helperProfile.user_id)
      .eq("stripe_account_id", account.id)
      .eq("stripe_identity_verified", helperProfile.stripe_identity_verified)
      .eq("stripe_charges_enabled", helperProfile.stripe_charges_enabled)
      .eq("stripe_payouts_enabled", helperProfile.stripe_payouts_enabled)
      .select("id");
    if (!idvErr && (idvRows?.length ?? 0) === 0) {
      // Zero rows means one of two things; a re-read tells them apart.
      const { data: current, error: reReadErr } = await supabase
        .from("profiles")
        .select("stripe_account_id, stripe_identity_verified, stripe_charges_enabled, stripe_payouts_enabled")
        .eq("user_id", helperProfile.user_id)
        .maybeSingle();
      if (reReadErr) {
        throw new Error(`Re-read after a zero-row cache write failed for ${helperProfile.user_id}: ${reReadErr.message}`);
      }
      if (current?.stripe_account_id !== account.id) {
        // LEGITIMATE, not a failed write: this event is for an account the
        // profile no longer points at (a stale event for a replaced or
        // cleared account). There is nothing to cache, and the payout
        // notices below would describe an account the helper no longer has,
        // so stop. No throw: a Stripe retry would only match zero again.
        logStep("Skipped stale account.updated: profile no longer links this account", {
          userId: helperProfile.user_id,
          accountId: account.id,
        });
        return;
      }
      // Still linked, so a concurrent writer changed the cached values
      // between our read and our write.
      if (
        current.stripe_identity_verified === identityVerified &&
        current.stripe_charges_enabled === chargesEnabled &&
        current.stripe_payouts_enabled === payoutsEnabled
      ) {
        // It wrote exactly what we would have (a concurrent delivery, or
        // stripe-connect `status` caching on return from onboarding). The
        // row is current and that writer owned the transition, so there is
        // nothing to do and no notice to send. Not an error: throwing here
        // would page ops for ordinary concurrency.
        logStep("Skipped account.updated: a concurrent write already cached these flags", {
          userId: helperProfile.user_id,
          accountId: account.id,
        });
        return;
      }
      // It wrote something different. Throw: the webhook answers 500 and
      // Stripe redelivers; the retry re-reads, re-retrieves and re-compares
      // against what is on file then. Nothing is sent from this attempt.
      throw new Error(`Cached payout flags for ${helperProfile.user_id} changed concurrently; asking Stripe to redeliver`);
    }
    if (idvErr) {
      // Still log-don't-throw, even now that this gates hiring: a dropped
      // write fails in the SAFE direction — the columns keep their previous
      // (never over-claiming) values, so the gate stays closed rather than
      // opening. The next account.updated event re-attempts it, and since
      // nothing was cached, THAT event still sees the transition and sends
      // the verified notice this one withholds.
      logStep("⚠️ failed to cache Stripe identity verdict", {
        userId: helperProfile.user_id,
        error: idvErr.message,
      });
    } else {
      becameEnabled = nowEnabled && !wasEnabled;
      logStep("Cached Stripe identity verdict", {
        userId: helperProfile.user_id,
        identityVerified,
        chargesEnabled,
        payoutsEnabled,
      });
    }
  }

  if (becameEnabled) {
    // Q872 — the residual same-snapshot race. Two deliveries can read the
    // same cached snapshot; the one holding the NEWER (restricted) retrieve
    // sees nothing to write and skips, and the one holding the OLDER
    // (enabled) retrieve then wins its CAS. So a write that moved the cache
    // INTO enabled asks Stripe once more before it is believed. If Stripe now
    // disagrees, the cache is put back to what Stripe says, by a CAS on the
    // exact values this delivery just wrote (a newer writer in between wins),
    // and no "verified" notice goes out.
    let recheck: { identity: boolean; charges: boolean; payouts: boolean } | null = null;
    try {
      const again = await stripe.accounts.retrieve(account.id);
      recheck = {
        identity: stripeIdentityVerified(again),
        charges: again.charges_enabled === true,
        payouts: again.payouts_enabled === true,
      };
    } catch (err) {
      if (isUnusableConnectAccountError(err)) {
        recheck = { identity: false, charges: false, payouts: false };
      } else {
        // Could not ask. The write above came from a retrieve made moments
        // ago, so keep it rather than guess; the next account.updated or
        // Payment-tab `status` re-syncs.
        logStep("⚠️ could not re-confirm an enabled payout account; keeping the cached write", {
          userId: helperProfile.user_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (recheck && !(recheck.charges && recheck.payouts)) {
      const { data: revertRows, error: revertErr } = await supabase
        .from("profiles")
        .update({
          stripe_identity_verified: recheck.identity,
          stripe_charges_enabled: recheck.charges,
          stripe_payouts_enabled: recheck.payouts,
        })
        .eq("user_id", helperProfile.user_id)
        .eq("stripe_account_id", account.id)
        .eq("stripe_identity_verified", identityVerified)
        .eq("stripe_charges_enabled", chargesEnabled)
        .eq("stripe_payouts_enabled", payoutsEnabled)
        .select("id");
      if (revertErr) {
        // Throw: the enabled cache is wrong. Stripe redelivers, and the retry
        // reads the enabled snapshot, retrieves restricted, and writes it.
        throw new Error(`Could not revert a stale enabled cache for ${helperProfile.user_id}: ${revertErr.message}`);
      }
      // Zero rows is legitimate: a newer writer changed the row after ours.
      logStep("Reverted an enabled cache Stripe no longer agrees with; no verified notice", {
        userId: helperProfile.user_id,
        rows: revertRows?.length ?? 0,
      });
      return;
    }

    // There used to be an "auto-approve" branch here (email verified +
    // approval_status 'pending' → 'approved' + a "Welcome in." notice). The
    // approval step is retired (Q193/Q205b) and a confirmed email already
    // left nobody 'pending', so only this notice was ever reachable.
    //
    // Q870: only the write that moved the cache INTO enabled sends it.
    // stripe-connect `status` runs the same transition CAS and sends the same
    // notice when it gets there first (Q873), so exactly one writer sends it.
    await insertNotifications(supabase, {
      user_id: helperProfile.user_id,
      title: "Payout account verified",
      message: "Your payout account is fully set up! You can now receive payments for completed jobs.",
      type: "success",
      // Name the tab. Bare "/profile" opens the LANDING tab (resolveTab,
      // src/pages/profile/types.ts), which says nothing about payouts.
      link: "/profile?tab=payment",
    });
    logStep("Helper payout account verified", { userId: helperProfile.user_id, email_verified: helperProfile.email_verified });
  } else if (!nowEnabled && account.requirements?.currently_due && account.requirements.currently_due.length > 0) {
    // Q874 — Stripe sends account.updated in bursts while an account is
    // restricted (every requirement, capability and person change), and this
    // used to insert a fresh "needs attention" notice for each one. Send it
    // only when the helper has no UNREAD copy of it: one standing notice per
    // episode, and a new one once they have read it and the account still
    // needs them. A failed check throws so Stripe redelivers, rather than
    // guessing either way.
    const { data: unread, error: unreadErr } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", helperProfile.user_id)
      .eq("title", NEEDS_ATTENTION_TITLE)
      .eq("read", false)
      .limit(1);
    if (unreadErr) {
      throw new Error(`Could not check for an unread payout notice for ${helperProfile.user_id}: ${unreadErr.message}`);
    }
    if ((unread?.length ?? 0) > 0) {
      logStep("Skipped needs-attention notice: an unread one is already showing", { userId: helperProfile.user_id });
      return;
    }
    await insertNotifications(supabase, {
      user_id: helperProfile.user_id,
      title: NEEDS_ATTENTION_TITLE,
      message: "Your payout account requires additional information. Please update your details to continue receiving payments.",
      type: "warning",
      // "Please update your details" has to land ON the details.
      link: "/profile?tab=payment",
    });
    logStep("Helper account needs attention", { userId: helperProfile.user_id, due: account.requirements.currently_due });
  }
}
