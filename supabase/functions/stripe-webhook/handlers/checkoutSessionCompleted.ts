import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { PRODUCT_TO_TIER, ONE_TIME_PRODUCTS } from "../constants.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { TIER_FEE_PERCENT } from "../../_shared/helperFees.ts";
import { sendPifGiftEmail } from "../../_shared/pifGiftEmail.ts";
import { settleOnboardingFee } from "./settleOnboardingFee.ts";
import { subscriptionCurrentPeriodEndISO } from "../../_shared/stripeSubscriptionPeriod.ts";
import {
  type SubscriptionLinkage,
  oneTimePassLinkage,
  subscriptionLinkage,
} from "../../_shared/subscriptionLinkage.ts";

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
  // The Stripe objects that paid for this tier. Written alongside the grant so
  // the membership can be reconciled against Stripe afterwards — before this,
  // the only join back was the customer's email, which is not unique in
  // `profiles` and which one person can hold several Stripe customers on.
  let linkage: SubscriptionLinkage | null = null;

  if (session.mode === "subscription") {
    const subscriptionId = session.subscription as string;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const productId = subscription.items.data[0]?.price.product as string;
    // Product map first; `create-pro-checkout` also stamps the tier onto the
    // session metadata, and that fallback is what stops an unmapped product id
    // from silently granting NOTHING (the `if (tier)` block below is skipped
    // entirely when tier is null — a paid checkout with no entitlement and no
    // alert). Test-mode Basic and Pro products were exactly in that state.
    tier = PRODUCT_TO_TIER[productId] || null;
    if (!tier) {
      const metaTier = (session.metadata as Record<string, string> | null)?.tier;
      // DERIVED from the tier table, not hand-listed. This was
      // ["basic","pro","elite"] — the safety net below PRODUCT_TO_TIER, and it
      // had the same hole it exists to cover: a Plus checkout whose product id
      // was unmapped would fall through BOTH, and the handler would skip the
      // grant entirely. Paid, no entitlement. Taking the members from
      // TIER_FEE_PERCENT means the net always covers every sellable tier.
      // `free` is excluded because nobody checks out for it.
      const SELLABLE_TIERS = Object.keys(TIER_FEE_PERCENT).filter((t) => t !== "free");
      if (metaTier && SELLABLE_TIERS.includes(metaTier)) tier = metaTier;
      // Loud either way: an unmapped product means PRODUCT_TO_TIER is stale and
      // the next product added will hit the same hole without the metadata net.
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Subscription checkout — product id not in PRODUCT_TO_TIER",
        message: tier
          ? "Recovered the tier from session metadata, but _shared/productTiers.ts is missing this product id — add it."
          : "No tier could be resolved. The customer was charged and received NO entitlement. Reconcile manually.",
        fields: { product_id: productId ?? "(missing)", session_id: session.id, recovered_tier: tier ?? "(none)" },
      });
    }
    // NOT `subscription.current_period_end` — that property does not exist on
    // the pinned 2025-08-27.basil API version, and reading it threw
    // `RangeError: Invalid time value`, 500-ing this handler on every recurring
    // membership purchase. See _shared/stripeSubscriptionPeriod.ts.
    subscriptionEnd = subscriptionCurrentPeriodEndISO(subscription);
    // Cycle comes from the PRICE Stripe actually created, falling back to the
    // cycle the checkout was asked for. `create-pro-checkout` stamps
    // metadata.billing_cycle, but that is the request; the price is the fact.
    linkage = subscriptionLinkage(subscription, (session.metadata as Record<string, string> | null)?.billing_cycle);
    if (!subscriptionEnd) {
      // Grant anyway — the customer paid, and denying access is the worse
      // failure — but page ops, because a tier with no expiry is one the
      // expire-subscriptions sweep can never clear (it filters on
      // `subscription_expires_at IS NOT NULL`).
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Subscription — no period end on the Stripe subscription",
        message: "Could not read a current period end from any subscription item, so the tier is being granted with NO expiry. It will never lapse on its own. Reconcile manually.",
        fields: { subscription_id: subscriptionId, session_id: session.id, tier: tier ?? "(none)" },
      });
    }
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
      // Recording the cycle is what keeps a pass out of the reconciler's
      // "tier with no live Stripe subscription" bucket — a pass legitimately
      // has no subscription object, and without this marker every pass buyer
      // would look like drift. It is also what stops the Membership card
      // telling a 30-day pass holder that their membership renews.
      linkage = oneTimePassLinkage(session.customer);
    }
  }

  logStep("Checkout completed", { email: customerEmail, tier, mode: session.mode, isOneTimePass });

  if (tier) {
    const updateData: any = { subscription_tier: tier };
    if (subscriptionEnd) {
      updateData.subscription_expires_at = subscriptionEnd;
    }
    // Spread whole, not field-by-field: every key is a projection of the Stripe
    // object, so a redelivery of this event recomputes identical values and the
    // UPDATE is a byte-identical no-op. Stripe retries; this has to tolerate it.
    if (linkage) Object.assign(updateData, linkage);

    // Grant by user_id whenever we have it. `profiles.email` has NO unique
    // constraint, so `.eq("email", …)` could update several rows (case variant,
    // stale unconfirmed signup) and hand a paid tier to the wrong account from
    // one payment. create-pro-checkout now stamps client_reference_id +
    // metadata.user_id; the email path remains only for legacy sessions created
    // before that change, and is logged so the fallback is visible.
    const buyerUserId =
      session.client_reference_id || (session.metadata as any)?.user_id || null;

    if (!buyerUserId) {
      logStep("No user_id on session — falling back to email match", { email: customerEmail });
    }

    // `.select("user_id")` is retained from the upstream fix so the 0-row branch
    // below can still detect a payment that granted nothing — that check matters
    // MORE on the email fallback path, which is exactly where a mismatch happens.
    const updateQuery = supabase.from("profiles").update(updateData);
    const { data: updatedProfiles, error } = buyerUserId
      ? await updateQuery.eq("user_id", buyerUserId).select("user_id")
      : await updateQuery.eq("email", customerEmail).select("user_id");

    if (error) {
      logStep("ERROR updating profile", { error: error.message });
      // Throw so the outer handler rolls back the idempotency row and returns
      // 500 — letting Stripe redeliver once the DB recovers. A silent 200 here
      // permanently loses the entitlement: customer.subscription.updated is a
      // fallback for recurring subscriptions, but one-time passes only fire
      // checkout.session.completed, so there is no second chance.
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Subscription — tier not applied after payment captured",
        message: "A subscription checkout captured but the profiles UPDATE (subscription_tier) failed. Stripe will retry; if the issue persists, reconcile manually.",
        fields: {
          session_id: session.id,
          email: customerEmail ?? "(missing)",
          tier: tier ?? "(missing)",
          db_error: error.message,
        },
      });
      throw new Error(`Failed to apply subscription tier '${tier}' for ${customerEmail}: ${error.message}`);
    } else if (!updatedProfiles || updatedProfiles.length === 0) {
      // UPDATE succeeded but matched 0 rows: the Stripe customer email has no
      // matching profile. The user was charged but received no entitlement.
      // customer.subscription.updated also resolves by email, so it will hit
      // the same 0-row result — retrying won't help; ops must reconcile.
      logStep("WARNING: tier update matched 0 profiles — email mismatch", { email: customerEmail, tier });
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Subscription tier not granted — no matching profile",
        message: "A customer's checkout completed but no profile matched their Stripe email. They were charged but have no access. Reconcile manually.",
        fields: { email: customerEmail ?? "(missing)", tier: String(tier), session_id: session.id },
      });
    } else {
      logStep("Profile updated with tier", { email: customerEmail, tier, expires: subscriptionEnd });
    }
  }

  // Handle tip checkout completion
  const sessionType = (session.metadata as any)?.type;
  if (sessionType === "tip") {
    const tipJobId = (session.metadata as any)?.job_id;
    const tipperId = (session.metadata as any)?.tipper_id;
    const tipHelperId = (session.metadata as any)?.helper_id;
    if (tipJobId && tipperId) {
      // Idempotency: the notify must fire once per tip, not once per webhook
      // delivery. The UPDATE only matches a still-'pending' row, so a
      // re-delivery flips 0 rows — `.select()` lets us see that and skip the
      // duplicate notification. Without this gate a retried delivery would
      // re-notify the helper of a tip they were already told about.
      const { data: flippedTip, error: tipError } = await supabase
        .from("tips")
        .update({ payment_status: "paid" })
        .eq("job_id", tipJobId)
        .eq("tipper_id", tipperId)
        .eq("stripe_session_id", session.id)
        .eq("payment_status", "pending")
        .select("id");
      if (tipError) {
        logStep("ERROR updating tip status", { error: tipError.message });
        // A captured tip charge whose row never flips to 'paid' leaves the
        // helper unpaid AND un-notified — a money↔ledger divergence, not a
        // benign log line. Await the alert and throw so the outer handler
        // rolls back the idempotency row and returns 500, letting Stripe
        // retry once the DB recovers. A silent return here permanently drops
        // the tip (same mistake that existed in customerSubscriptionUpdated).
        await postSlackOpsAlert({
          kind: "custom",
          severity: "critical",
          title: "Tip payment — status flip failed",
          message: "A tip checkout captured but the tips row was not marked paid, so the helper wasn't notified. Stripe will retry.",
          fields: {
            session_id: session.id,
            job_id: String(tipJobId),
            tipper_id: String(tipperId),
            helper_id: tipHelperId ? String(tipHelperId) : "(missing)",
            db_error: tipError.message,
          },
        });
        throw new Error(`Tip status flip failed for job ${tipJobId}: ${tipError.message}`);
      } else if (flippedTip && flippedTip.length > 0) {
        logStep("Tip marked as paid", { jobId: tipJobId, tipper: tipperId });
        // Notify the helper — only on the delivery that actually captured the tip.
        if (tipHelperId) {
          await supabase.from("notifications").insert({
            user_id: tipHelperId,
            title: "You received a tip!",
            message: `Someone tipped you for a completed job. Thanks for the great work!`,
            type: "payment",
            link: "/earnings",
          });
        }
      } else {
        logStep("Tip already paid (duplicate delivery) — skipping notify", { jobId: tipJobId, tipper: tipperId });
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
      // `.select("id")` + a zero-row branch, exactly like the escrow twin below.
      // A null error does NOT mean the write happened, and this is the one boost
      // path where the user actually PAID — both free paths in
      // create-boost-payment already carry this guard.
      //
      // The zero-row case is reachable, not theoretical: create-boost-payment
      // gates only on `status = 'open'` and never stamps `stripe_session_id`,
      // so 20260903055308's delete guard — which keys on that column — does not
      // cover a boost checkout at all. The poster can delete the job (RLS still
      // allows it at unpaid+no-session or abandoned) while the Stripe page is
      // open, and an admin delete bypasses RLS entirely. Without this branch the
      // UPDATE matched zero rows, returned `error: null`, fell through to the
      // `else` and logged "Boost applied" — then the webhook 200-ACKed, which
      // COMMITS the idempotency row, so Stripe's redelivery dedupe-skips and the
      // paid boost is lost permanently with no alert.
      const { data: boostedRows, error: boostError } = await supabase
        .from("jobs")
        .update({
          boosted_at: now.toISOString(),
          boost_expires_at: expires.toISOString(),
          boost_auto_extended: false,
        })
        .eq("id", boostJobId)
        .select("id");
      if (boostError || !boostedRows || boostedRows.length === 0) {
        logStep("ERROR applying boost", {
          error: boostError?.message ?? "matched 0 rows — job deleted mid-checkout",
        });
        // Throw so the outer handler rolls back the idempotency row and returns
        // 500 — letting Stripe redeliver once the DB recovers. A silent 200 here
        // permanently loses the boost: the user paid but it never activates with
        // no retry path. The re-delivered UPDATE is idempotent (sets the same
        // timestamps) so it is safe to retry. A retry cannot fix the job-deleted
        // case, and that is deliberate and matches the escrow handler: the point
        // is that the charge stays visibly unreconciled instead of silently
        // disappearing, so someone refunds it.
        await postSlackOpsAlert({
          kind: "custom",
          severity: "critical",
          title: boostError
            ? "Job boost — activation failed after payment captured"
            : "Job boost — THE JOB IS GONE and the payment was captured",
          message: boostError
            ? "A boost checkout captured but the jobs UPDATE (boosted_at/boost_expires_at) failed. Stripe will retry."
            : "A boost checkout captured but the job row no longer exists, so the boost can never be applied. Refund the charge — Stripe will keep retrying until someone does.",
          fields: {
            session_id: session.id,
            job_id: String(boostJobId),
            duration_hours: String(durationHours),
            db_error: boostError?.message ?? "matched 0 rows",
          },
        });
        throw new Error(
          `Boost activation failed for job ${boostJobId}: ${boostError?.message ?? "matched 0 rows"}`,
        );
      } else {
        logStep("Boost applied", { jobId: boostJobId, expires: expires.toISOString() });
      }
    }
  }

  // Standalone account-setup-fee checkout (from pay-onboarding-fee). It has no
  // job and no escrow, so it never reaches the job-scoped settlement below —
  // hence its own branch, calling the same claim-or-refund.
  if (kind === "onboarding_fee") {
    const feePiId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent as any)?.id;
    if (!feePiId) {
      logStep("WARNING: onboarding_fee checkout with no payment_intent", { sessionId: session.id });
    } else {
      await settleOnboardingFee(session, feePiId, { stripe, supabase, logStep });
    }
    return;
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
      // Idempotency: a webhook re-delivery must not create a SECOND credential
      // row, check run, and "started" notification. A helper can only have one
      // background check in flight, so an already-'submitted' credential means
      // this delivery is a duplicate — skip the side-effects. Fail OPEN on a
      // read error (proceed with the insert): a duplicate credential an admin
      // can dedupe is far less harmful than silently dropping a paid check that
      // then never runs.
      const { data: existingBgc, error: existingBgcErr } = await supabase
        .from("helper_credentials")
        .select("id")
        .eq("user_id", bgcUserId)
        .eq("credential_type", "background_check")
        .eq("status", "submitted")
        .limit(1)
        .maybeSingle();
      if (existingBgcErr) {
        logStep("WARNING: bgc idempotency check failed — proceeding (fail open)", { error: existingBgcErr.message, userId: bgcUserId });
      }
      if (existingBgc) {
        logStep("Background check already submitted (duplicate delivery) — skipping", { userId: bgcUserId });
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
          // The helper PAID for a background check but no credential row was
          // written, so the screening is never queued for the admin/vendor and
          // the badge never clears — paid service, no delivery. Alert ops.
          await postSlackOpsAlert({
            kind: "custom",
            severity: "critical",
            title: "Background check — credential not recorded",
            message: "A helper's background-check payment captured but the helper_credentials row failed to write, so the check was never queued. Reconcile manually.",
            fields: { session_id: session.id, user_id: String(bgcUserId), db_error: credErr.message },
          });
          // Throw so the outer handler rolls back the idempotency row and returns
          // 500 — letting Stripe retry once the DB recovers. A silent 200 here
          // commits the dedupe row permanently: the paid check is never queued
          // and the user never receives the confirmation notification (moved into
          // the success path below). The retry re-enters the else branch because
          // existingBgc finds nothing (the INSERT failed), and re-attempts the
          // credential creation cleanly.
          throw new Error(`Background check credential insert failed for user ${bgcUserId}: ${credErr.message}`);
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
          if (checkErr) {
            logStep("ERROR creating bgc check", { error: checkErr.message });
            // Credential row exists but the check run didn't — the admin queue
            // won't surface it, so the paid screening stalls silently. Alert ops.
            // Don't throw: a retry would see existingBgc (status='submitted') and
            // skip the else branch, so there is no clean Stripe-retry path here.
            // Ops must manually create the verification_checks row.
            await postSlackOpsAlert({
              kind: "custom",
              severity: "critical",
              title: "Background check — check run not created",
              message: "A background-check credential was recorded but its verification_checks run failed to write, so it won't appear in the admin queue. Reconcile manually.",
              fields: { session_id: session.id, user_id: String(bgcUserId), credential_id: String(cred.id), db_error: checkErr.message },
            });
          }

          // Notify only on confirmed credential creation. Previously this ran
          // unconditionally so the user received "Background check started" even
          // when the credential INSERT had just failed and we threw above.
          await supabase.from("notifications").insert({
            user_id: bgcUserId,
            title: "Background check started",
            message:
              "Thanks — your payment went through and your background check is in progress. We'll add your Background-Checked badge as soon as it clears.",
            // `verified` — this is a credential/verification event about the
            // reader's own account, and it is the type the notification centre
            // already draws a shield for. `success` mapped it to `work_status`
            // ("Helpr status update"), so muting job progress muted it.
            type: "verified",
            link: "/profile",
          });
          logStep("Background check initiated", { userId: bgcUserId });
        }
      }
    }
  }

  // Handle a directed Pay-It-Forward gift — the donor's card just captured, so
  // MINT the prepaid credit now. The webhook (service-role) is the ONLY writer
  // of pif_credits; the client mint path was removed so a recipient can never
  // fabricate or inflate a credit. Everything needed to mint rides in the
  // session metadata set by create-pif-donation.
  if (kind === "pif_donation") {
    const donorId = (session.metadata as any)?.donor_id as string | undefined;
    const donorName = ((session.metadata as any)?.donor_name as string | undefined)?.trim() || "Someone";
    const recipientEmail = ((session.metadata as any)?.recipient_email as string | undefined)?.trim().toLowerCase();
    const amountCents = parseInt((session.metadata as any)?.amount_cents || "0", 10);
    const giftCategory = ((session.metadata as any)?.category as string | undefined) || "Any";
    const giftMessage = ((session.metadata as any)?.message as string | undefined) || null;
    // Presentation only: which occasion the sender picked and which card art
    // they chose. Empty string → null so an older client that never sends
    // these doesn't write "" and make "no occasion" look like a real choice.
    const giftOccasion = ((session.metadata as any)?.occasion as string | undefined) || null;
    const giftDesignId = ((session.metadata as any)?.design_id as string | undefined) || null;
    const pifPiId = typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent as any)?.id;

    if (!donorId || !recipientEmail || !Number.isFinite(amountCents) || amountCents <= 0) {
      logStep("WARNING: pif_donation checkout missing required metadata", {
        donorId, recipientEmail, amountCents,
      });
      // A captured donation charge that can't be minted (bad/missing metadata)
      // is money in with no credit out — a real ledger divergence. Alert ops
      // instead of only logging, or the gift silently vanishes.
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Gift card donation — unmintable (bad metadata)",
        message: "A donor's gift charge captured but the session metadata was missing/invalid, so no credit could be minted. Reconcile manually.",
        fields: {
          session_id: session.id,
          donor_id: donorId ?? "(missing)",
          recipient_email: recipientEmail ?? "(missing)",
          amount_cents: String(amountCents),
        },
      });
    } else {
      // Idempotency: a webhook re-delivery must not double-mint. The credit is
      // keyed to this checkout session, so skip if one already exists. A FAILED
      // read here must fail closed — falling through to the insert on a transient
      // DB error would double-mint on the retried delivery (money from nothing).
      const { data: existing, error: existErr } = await supabase
        .from("pif_credits")
        .select("id")
        .eq("stripe_session_id", session.id)
        .maybeSingle();
      if (existErr) {
        logStep("ERROR checking existing pif credit — aborting mint (fail closed)", { error: existErr.message, sessionId: session.id });
        // Await the alert before throwing: the outer handler rolls back the
        // idempotency row and returns 500, which triggers Stripe's retry schedule.
        // A plain `return` would commit the row (200 OK) so Stripe never retries
        // and the donor's captured charge permanently loses its credit — money in,
        // no gift out. Throwing is the only path that lets Stripe re-deliver.
        await postSlackOpsAlert({
          kind: "custom",
          severity: "critical",
          title: "Gift card mint — idempotency check failed",
          message: "Couldn't verify whether this gift was already minted, so the mint was skipped to avoid a double-credit. Returning 500 so Stripe retries; if it keeps failing, reconcile manually.",
          fields: { session_id: session.id, donor_id: donorId, recipient_email: recipientEmail, db_error: existErr.message },
        });
        throw new Error(`pif_credits idempotency check failed for session ${session.id}: ${existErr.message}`);
      }

      if (existing) {
        logStep("pif_donation already minted for session — skipping", { sessionId: session.id });
      } else {
        // Resolve the recipient's account if the named email already belongs to
        // a Helpr user. Otherwise recipient_id stays null and the credit is
        // claimed via the emailed token when they sign up / sign in.
        //
        // SECURITY: only auto-bind to an account whose email is CONFIRMED.
        // profiles.email is trigger-seeded from auth.users.email at signup —
        // which exists even for an UNCONFIRMED signup — so binding on the
        // profile match alone lets an attacker who knows the target address
        // pre-register it (unconfirmed) and have a directed gift auto-attach to
        // their account, bypassing the claim flow's email-ownership check. By
        // requiring email_confirmed_at we prove the account owns the address;
        // an unconfirmed match falls through to recipient_id=null and must go
        // through claim-pif-credit (which matches the caller's confirmed JWT
        // email), so nothing is lost — just no instant in-app bind.
        const { data: recipientProfile, error: profileErr } = await supabase
          .from("profiles")
          .select("user_id")
          .eq("email", recipientEmail)
          .maybeSingle();
        if (profileErr) {
          // Fails safe (no match → unbound → claimable via token), but never
          // drop the error silently — log it so a transient lookup outage that
          // suppresses the instant in-app bind is visible.
          logStep("WARNING: recipient profile lookup failed — leaving unbound (claim required)", { recipientEmail, error: profileErr.message });
        }
        const candidateId = (recipientProfile?.user_id as string | undefined) ?? null;
        let recipientId: string | null = null;
        if (candidateId) {
          const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(candidateId);
          if (authErr) {
            // Can't verify ownership → fail closed on the auto-bind (don't risk
            // binding to an unconfirmed impostor). The gift still mints; the
            // real recipient claims it via the emailed token.
            logStep("WARNING: couldn't verify recipient email confirmation — leaving unbound", { candidateId, error: authErr.message });
          } else if (authUser?.user?.email_confirmed_at) {
            recipientId = candidateId;
          } else {
            logStep("pif_donation: matched profile email is unconfirmed — not auto-binding (claim required)", { recipientEmail });
          }
        }

        // 32 bytes of CSPRNG entropy → the claim link's bearer token.
        const tokenBytes = new Uint8Array(32);
        crypto.getRandomValues(tokenBytes);
        const claimToken = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, "0")).join("");

        const { error: mintErr } = await supabase.from("pif_credits").insert({
          donor_id: donorId,
          recipient_id: recipientId,
          recipient_email: recipientEmail,
          amount: amountCents / 100,
          status: "sent",
          payment_status: "paid",
          category: giftCategory,
          message: giftMessage,
          occasion: giftOccasion,
          design_id: giftDesignId,
          claim_token: claimToken,
          stripe_session_id: session.id,
          stripe_payment_intent_id: pifPiId ?? null,
        });

        if (mintErr) {
          logStep("ERROR minting pif credit", { error: mintErr.message, sessionId: session.id });
          // A captured charge with no credit row is a real money↔ledger divergence.
          // Await the alert before throwing so ops is paged even if the function
          // terminates quickly. The throw propagates to the outer webhook handler,
          // which rolls back the idempotency row and returns 500 — Stripe retries
          // once the DB recovers, the idempotency check finds no dedupe row, the
          // existing-credit check finds no row, and the mint re-runs cleanly.
          // Without the throw Stripe 200-ACKs and the gift is permanently undelivered
          // (same failure mode that existErr guards against above).
          await postSlackOpsAlert({
            kind: "custom",
            severity: "critical",
            title: "Gift card mint failed — Stripe will retry",
            message: "A donor's gift charge captured but the pif_credits row was not written. Returning 500 so Stripe retries; if retries exhaust, reconcile manually.",
            fields: {
              session_id: session.id,
              donor_id: donorId,
              recipient_email: recipientEmail,
              amount_cents: String(amountCents),
              db_error: mintErr.message,
            },
          });
          throw new Error(`pif_credits insert failed for session ${session.id}: ${mintErr.message}`);
        } else {
          logStep("Gift card minted", { sessionId: session.id, recipientEmail, amountCents });

          // In-app notify an already-registered recipient right away.
          if (recipientId) {
            await supabase.from("notifications").insert({
              user_id: recipientId,
              title: "You received a Helpr credit!",
              message: `${donorName} sent you a $${(amountCents / 100).toFixed(0)} credit to use toward any job. Tap to redeem it.`,
              type: "payment",
              link: "/gift-card",
            });
          }

          // ALWAYS email the named address — the claim link both onboards a
          // brand-new recipient and doubles as a receipt for a registered one.
          const emailed = await sendPifGiftEmail({
            recipientEmail,
            donorName,
            amountCents,
            message: giftMessage,
            claimToken,
          });
          if (!emailed) logStep("WARNING: pif gift email not sent", { recipientEmail, sessionId: session.id });
        }
      }
    }
  }

  // Pay It Forward — partial (difference) payment completed. The recipient's
  // gift was RESERVED against this job (create-payment's PIF branch); their
  // card just covered the shortfall, so consume the reservation now. Idempotent:
  // the UPDATE only matches a still-'reserved' row, so a webhook re-delivery is
  // a no-op. The generic job block below sets payment_status → "escrow" and
  // stores the difference PI, which is all the payout path needs (it detects
  // PIF funding via this redeemed credit and pays the helper from the platform
  // balance, not from the difference PI).
  const pifCreditId = (session.metadata as any)?.pif_credit_id as string | undefined;
  if (pifCreditId) {
    const { data: consumed, error: consumeErr } = await supabase
      .from("pif_credits")
      .update({ status: "redeemed", redeemed_at: new Date().toISOString() })
      .eq("id", pifCreditId)
      .eq("status", "reserved")
      .select("id")
      .maybeSingle();
    if (consumeErr) {
      logStep("ERROR consuming reserved pif credit", { error: consumeErr.message, pifCreditId });
      // Await the alert before throwing so it fires reliably; the throw rolls
      // back the idempotency row and returns 500, letting Stripe retry once
      // the DB recovers. A plain return here commits the dedupe row — the
      // credit stays 'reserved' forever (unusable on another job) with no
      // retry path, and the shortfall charge has no matching redeemed record.
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Gift card difference payment — credit not consumed",
        message: "A recipient paid the shortfall on a reserved gift but pif_credits was not flipped to redeemed. Stripe will retry; if it persists, reconcile manually.",
        fields: { session_id: session.id, pif_credit_id: pifCreditId, db_error: consumeErr.message },
      });
      throw new Error(`pif_credits status flip failed for session ${session.id}: ${consumeErr.message}`);
    } else if (!consumed) {
      logStep("Reserved pif credit already consumed or missing — skipping", { pifCreditId });
    } else {
      logStep("Reserved pif credit consumed on difference payment", { pifCreditId, sessionId: session.id });
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

    // Race-safe tax recording: the payment_intent.succeeded handler also writes
    // sales_tax_amount, but Stripe does not guarantee delivery order — if
    // payment_intent.succeeded fires FIRST it finds no job (stripe_payment_intent_id
    // not set yet), 200-ACKs, and the dedupe row is committed permanently, so tax
    // is never retried. Recording tax here ensures at least one of the two handlers
    // captures it regardless of delivery order. Errors are non-fatal: a Stripe API
    // hiccup only delays tax recording until payment_intent.succeeded fires (if it
    // fires after this event, which is the common case).
    try {
      const taxPi = await stripe.paymentIntents.retrieve(piId);
      // `> 0` here would never let a genuine $0 clear the estimate written at
      // insert time — and $0 is the normal outcome, since only assembly labor
      // is taxable. Write whenever Stripe HAS a number; skip only when the
      // field is absent, which means "no information", not "zero".
      const taxCents = (taxPi.amount_details as any)?.tax?.total_tax_amount;
      if (typeof taxCents === "number") {
        updateData.sales_tax_amount = taxCents / 100;

        // ...and the RATE, derived from what Stripe actually charged rather
        // than from our own parish table.
        //
        // `sales_tax_amount` has been Stripe-sourced here for a while, but
        // `sales_tax_rate` was still the ESTIMATE written at insert time from
        // `parish_tax_rates` — so a job could carry Stripe's real amount beside
        // our guessed rate, and rate x budget would not reconcile to the
        // amount. That table is also where the DeSoto/LaSalle spelling mismatch
        // lived, which resolved to a rate of 0 for seven ZIP codes.
        //
        // The effective rate is the only honest one: tax over the base it was
        // charged on. Tax lands on the LABOR line only (the fees all ship as
        // txcd_00000000), so the base is the budget.
        const { data: jobRow } = await supabase
          .from("jobs")
          .select("budget")
          .eq("id", jobId)
          .maybeSingle();
        const budgetCents = Math.round(Number(jobRow?.budget ?? 0) * 100);
        if (budgetCents > 0) {
          // Two decimals: rates are quoted like 10.00 / 10.50, and an
          // unrounded float here would persist 9.999999999 for a clean 10%.
          updateData.sales_tax_rate =
            Math.round((taxCents / budgetCents) * 100 * 100) / 100;
        } else if (taxCents === 0) {
          // A genuine zero with no base to divide by — an exempt category.
          updateData.sales_tax_rate = 0;
        }
      }
    } catch (taxErr) {
      logStep("WARN: PI retrieve failed in checkout handler — payment_intent.succeeded will record tax", {
        piId,
        error: String(taxErr),
      });
    }

    // `.select("id")` and the zero-row check are the whole point, and their
    // absence was a live money-loss path.
    //
    // A poster may DELETE their own job while it is `payment_status='unpaid'`,
    // which is NOT the moneyless state — it is the money-IN-FLIGHT state.
    // create-payment stamps `stripe_session_id` and deliberately leaves the
    // status `unpaid`; only this handler flips it to `escrow`. So a job can be
    // gone by the time Stripe calls back, and then:
    //
    //   UPDATE ... WHERE id = <deleted>  ->  { data: [], error: null }
    //
    // which took the SUCCESS branch: logged "Stored payment_intent and escrow
    // status on job", fanned out helper matches, committed the idempotency row
    // and 200-ACKed, so Stripe never retried. The Slack alert hangs off
    // `jobError`, so nothing fired. Money captured, no local record.
    //
    // Neither recovery path covers it: paymentIntentSucceeded looks the job up
    // by `stripe_payment_intent_id`, which this write is what sets; and
    // money-reconciliation makes zero Stripe calls — every check starts from a
    // `jobs` row, so a deleted job is invisible to it by construction.
    //
    // create-payment's own escrow write already carries this guard, with a
    // comment saying exactly why. The write that marks the job FUNDED did not.
    const { data: jobUpdated, error: jobError } = await supabase
      .from("jobs")
      .update(updateData)
      .eq("id", jobId)
      .select("id");
    if (jobError || !jobUpdated || jobUpdated.length === 0) {
      logStep("ERROR storing PI on job", {
        error: jobError?.message ?? "matched 0 rows — job deleted mid-checkout",
      });
      // The payment is CAPTURED but the job never got marked funded/escrow —
      // a money↔state divergence (funds held, job looks unpaid). Throw so
      // the outer handler rolls back the idempotency row and returns 500,
      // letting Stripe retry once the DB recovers. Matches the tip/boost/
      // subscription error paths in this same handler.
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: jobError
          ? "Escrow funding — job not marked funded after capture"
          : "Escrow funding — THE JOB IS GONE and the payment was captured",
        message: jobError
          ? "A checkout was captured but the jobs UPDATE (payment_status→escrow/payout_pending) failed. Stripe will retry once the DB recovers."
          : "A checkout was captured and the job row no longer exists — deleted while its checkout was open. Stripe holds the money and nothing local references it. This will NOT self-heal: paymentIntentSucceeded looks the job up by stripe_payment_intent_id, which this write is what sets, and money-reconciliation makes no Stripe calls. Refund from the Stripe dashboard using the session id below.",
        fields: {
          session_id: session.id,
          job_id: jobId,
          payment_intent: piId,
          repay: String(isRepay),
          db_error: jobError?.message ?? "matched 0 rows — job deleted mid-checkout",
        },
      });
      throw new Error(
        `Escrow update failed for job ${jobId} (PI ${piId}): ${
          jobError?.message ?? "matched 0 rows — job deleted mid-checkout"
        }`,
      );
    } else {
      logStep("Stored payment_intent and escrow status on job", { jobId, pi: piId, repay: isRepay });

      // Fan out the helper match — HERE, and only here, because this is the
      // first moment the job is actually funded.
      //
      // It used to run in the browser (PostJob's useJobSubmit) the instant
      // create-payment handed back a Checkout URL — i.e. BEFORE the poster had
      // even opened Stripe. Since migration 20260831010000 all three browse
      // surfaces require payment_status IN ('escrow','payout_pending',
      // 'released'), so those pushes advertised a job every one of those
      // surfaces refused to return: up to 20 helpers told about work they could
      // not see, and nothing at all if the poster then abandoned checkout.
      // instant-job-match now enforces that same funded predicate itself, so
      // the pre-funding call could only ever no-op — the trigger had to move to
      // the point where the predicate becomes true.
      //
      // Skipped for `repay`: that path settles an EXISTING job that already has
      // its helper, so there is nobody to match.
      //
      // Best-effort by design. A match fan-out must never fail a captured
      // payment — the job is funded and discoverable through browse regardless,
      // so a failure here costs reach, not correctness. Logged, never thrown.
      if (!isRepay) {
        try {
          const { error: matchError } = await supabase.functions.invoke("instant-job-match", {
            body: { jobId },
          });
          if (matchError) {
            logStep("WARN: instant-job-match failed after funding", { jobId, error: matchError.message });
          } else {
            logStep("Triggered instant-job-match after funding", { jobId });
          }
        } catch (matchErr) {
          logStep("WARN: instant-job-match threw after funding", { jobId, error: String(matchErr) });
        }
      }
    }

    // Collect the one-time setup fee this session carried, exactly once.
    // Claim-or-refund lives in settleOnboardingFee so the standalone
    // `pay-onboarding-fee` checkout shares one implementation of the
    // "never charged twice" guarantee rather than a second copy of it.
    if ((session.metadata as any)?.onboarding_fee_charged === "true") {
      await settleOnboardingFee(session, piId, { stripe, supabase, logStep });
    }
  } else if (jobId) {
    logStep("WARNING: checkout completed for job but no payment_intent on session", { jobId });
  }
}
