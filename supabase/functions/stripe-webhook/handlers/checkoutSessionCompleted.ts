import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { PRODUCT_TO_TIER, ONE_TIME_PRODUCTS } from "../constants.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { sendPifGiftEmail } from "../../_shared/pifGiftEmail.ts";

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
      postSlackOpsAlert({
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
            title: "💰 You received a tip!",
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
      const { error: boostError } = await supabase
        .from("jobs")
        .update({
          boosted_at: now.toISOString(),
          boost_expires_at: expires.toISOString(),
          boost_auto_extended: false,
        })
        .eq("id", boostJobId);
      if (boostError) {
        logStep("ERROR applying boost", { error: boostError.message });
        // Throw so the outer handler rolls back the idempotency row and returns
        // 500 — letting Stripe redeliver once the DB recovers. A silent 200 here
        // permanently loses the boost: the user paid but it never activates with
        // no retry path. The re-delivered UPDATE is idempotent (sets the same
        // timestamps) so it is safe to retry.
        await postSlackOpsAlert({
          kind: "custom",
          severity: "critical",
          title: "Job boost — activation failed after payment captured",
          message: "A boost checkout captured but the jobs UPDATE (boosted_at/boost_expires_at) failed. Stripe will retry.",
          fields: {
            session_id: session.id,
            job_id: String(boostJobId),
            duration_hours: String(durationHours),
            db_error: boostError.message,
          },
        });
        throw new Error(`Boost activation failed for job ${boostJobId}: ${boostError.message}`);
      } else {
        logStep("Boost applied", { jobId: boostJobId, expires: expires.toISOString() });
      }
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
          postSlackOpsAlert({
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
            postSlackOpsAlert({
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
            title: "🛡️ Background check started",
            message:
              "Thanks — your payment went through and your background check is in progress. We'll add your Background-Checked badge as soon as it clears.",
            type: "success",
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
      postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Pay It Forward donation — unmintable (bad metadata)",
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
          title: "Pay It Forward mint — idempotency check failed",
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
            title: "Pay It Forward gift mint failed — Stripe will retry",
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
          logStep("Pay It Forward gift minted", { sessionId: session.id, recipientEmail, amountCents });

          // In-app notify an already-registered recipient right away.
          if (recipientId) {
            await supabase.from("notifications").insert({
              user_id: recipientId,
              title: "🎁 You received a Helpr credit!",
              message: `${donorName} sent you a $${(amountCents / 100).toFixed(0)} credit to use toward any job. Tap to redeem it.`,
              type: "payment",
              link: "/pay-it-forward",
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
        title: "Pay It Forward difference payment — credit not consumed",
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
      const taxCents = (taxPi.amount_details as any)?.tax?.total_tax_amount ?? 0;
      if (taxCents > 0) {
        updateData.sales_tax_amount = taxCents / 100;
      }
    } catch (taxErr) {
      logStep("WARN: PI retrieve failed in checkout handler — payment_intent.succeeded will record tax", {
        piId,
        error: String(taxErr),
      });
    }

    const { error: jobError } = await supabase.from("jobs").update(updateData).eq("id", jobId);
    if (jobError) {
      logStep("ERROR storing PI on job", { error: jobError.message });
      // The payment is CAPTURED but the job never got marked funded/escrow —
      // a money↔state divergence (funds held, job looks unpaid). Throw so
      // the outer handler rolls back the idempotency row and returns 500,
      // letting Stripe retry once the DB recovers. Matches the tip/boost/
      // subscription error paths in this same handler.
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Escrow funding — job not marked funded after capture",
        message: "A checkout was captured but the jobs UPDATE (payment_status→escrow/payout_pending) failed. Stripe will retry once the DB recovers.",
        fields: { session_id: session.id, job_id: jobId, payment_intent: piId, repay: String(isRepay), db_error: jobError.message },
      });
      throw new Error(`Escrow update failed for job ${jobId} (PI ${piId}): ${jobError.message}`);
    } else {
      logStep("Stored payment_intent and escrow status on job", { jobId, pi: piId, repay: isRepay });
    }

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
            const ONBOARDING_FEE_CENTS = parseInt((session.metadata as any)?.onboarding_fee_cents || "200", 10);
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
            // Ledger the refund (best-effort). is_partial: this only refunds
            // the $2 fee off a PI that also holds the job escrow, so it is not
            // a full-PI refund. job_id is null — this is a profile/onboarding
            // fee, not a job's escrow, so a per-job reconciliation query must
            // NOT attribute it to the job on this session.
            const { error: refundLedgerErr } = await supabase.from("payment_refunds").upsert({
              job_id: null,
              customer_id: posterId,
              stripe_refund_id: refund.id,
              stripe_payment_intent_id: piId,
              amount_cents: Math.round(Number(refund.amount ?? ONBOARDING_FEE_CENTS)),
              currency: refund.currency ?? "usd",
              is_partial: true,
              reason: "duplicate onboarding fee",
              source: "duplicate_onboarding_fee",
              initiated_by_user_id: null,
            }, { onConflict: "stripe_refund_id", ignoreDuplicates: true });
            if (refundLedgerErr) {
              logStep("ERROR ledgering duplicate onboarding fee refund", {
                error: refundLedgerErr.message,
                refundId: refund.id,
                sessionId: session.id,
              });
              // The refund already left Stripe, so we never throw — but a dropped
              // ledger row is a real Stripe↔ledger divergence a human must
              // reconcile, so surface it to ops rather than leaving it in a log.
              postSlackOpsAlert({
                kind: "custom",
                severity: "warning",
                title: "Refund ledger write failed",
                message: "A Stripe refund succeeded but its payment_refunds row was not written. Reconcile manually.",
                fields: {
                  refund_id: refund.id,
                  session_id: session.id,
                  source: "duplicate_onboarding_fee",
                  db_error: refundLedgerErr.message,
                },
              });
            }
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
