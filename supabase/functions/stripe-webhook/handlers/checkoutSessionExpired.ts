import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { insertNotifications } from "../../_shared/insertNotifications.ts";

// A recipient started paying the shortfall on a gift card (their
// credit was smaller than the job budget), so create-payment's gift card branch
// RESERVED the credit against that job (status='reserved', job_id set) and
// opened a Stripe Checkout for the difference. If they abandon that checkout,
// Stripe expires the session and the credit would otherwise sit 'reserved'
// forever — unusable on any OTHER job and with no TTL to free it. Flip it back
// to 'sent' with job_id cleared so the recipient can redeem it again.
//
// Idempotent: the UPDATE only matches a still-'reserved' row for this exact
// credit, so a re-delivered expiry event (or one that races the completed
// event) is a harmless no-op. If the difference was actually paid, the credit
// is already 'redeemed' and this won't touch it.
export async function handleCheckoutSessionExpired(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  const meta = session.metadata as Record<string, string> | null;

  // ── Release the job's hold on this session ────────────────────────────────
  //
  // Runs for EVERY expired checkout, not just the gift card branch below.
  //
  // `jobs.stripe_session_id` is stamped when checkout opens and, until now, was
  // never cleared — an abandoned checkout left it set forever. That is what
  // makes the money lock safe to tighten: `enforce_poster_jobs_money_lock` now
  // refuses budget edits while a session id is present, and without this the
  // poster of an abandoned checkout could never edit their job's price again
  // and it would sit unpayable at the old amount.
  //
  // Three conditions, and each one matters:
  //   • `stripe_session_id = session.id` — only THIS session's hold is released,
  //     so a stale re-delivery cannot clear a newer checkout.
  //   • `payment_status = 'unpaid'` — a funded job is never touched, so an
  //     expiry racing a completion cannot un-stamp a paid job.
  //   • `.select("id")` — a zero-row match is a real outcome here, not a
  //     failure, but it must be observable rather than assumed.
  const jobId = meta?.job_id;
  if (jobId && session.id) {
    const { data: released, error: releaseErr } = await supabase
      .from("jobs")
      .update({ stripe_session_id: null })
      .eq("id", jobId)
      .eq("stripe_session_id", session.id)
      // 'failed' too (Q769): a declined card leaves the job failed with this
      // session's hold still stamped, and expiry is when that hold ends.
      .in("payment_status", ["unpaid", "failed"])
      .select("id, payment_status, customer_id, title")
      .maybeSingle();
    if (releaseErr) {
      // Throw for the same reason the gift card branch below does: a plain return
      // commits the dedupe row and acks 200 permanently, stranding the job
      // behind a session hold that nothing will ever clear.
      throw new Error(
        `Failed to clear stripe_session_id for job ${jobId} on expired checkout ${session.id}: ${releaseErr.message}`,
      );
    }
    logStep(
      released
        ? "Expired checkout — job session hold released, budget editable again"
        : "Expired checkout — job already funded or session superseded, hold left alone",
      { jobId, sessionId: session.id },
    );
    // Q769: the "not posted" notice for a declined card lives HERE, not in
    // payment_intent.payment_failed. Only now can the session no longer be
    // paid, so only now is "the job isn't posted" true. A job that was merely
    // abandoned (still 'unpaid') gets no notice: the poster walked away.
    if (released && released.payment_status === "failed" && released.customer_id) {
      await insertNotifications(supabase, {
        user_id: released.customer_id,
        // The subject reference: the seed boundary drops the row for a seed job,
        // and notificationDestination keeps "/post-job" (not an Activity path).
        job_id: released.id,
        title: "Payment failed",
        message: `Your payment for "${released.title}" didn't go through, so the job isn't posted. Open Post a Job and load your draft to try again with another card.`,
        type: "warning",
        // Post a Job, never My Posts: a never-paid job does not exist in Posts
        // (owner, 2026-09-27), and the draft is kept through checkout.
        link: "/post-job",
      });
      logStep("Notified poster: declined checkout expired, job not posted", { jobId });
    }
  }

  // ── An abandoned gift PURCHASE ──
  // create-gift-card-checkout now pre-registers the gift payment_status='pending'
  // at session-creation time, so a lost webhook leaves something queryable. That
  // creates a state nothing had ever seen before: a pending row that never
  // completes. It has exactly two causes, and they must not look alike:
  //
  //   1. the donor abandoned checkout — no money moved, nothing owed; and
  //   2. the donor PAID and the completion never reached us — money in, no credit.
  //
  // Stripe tells us which, and this is the event that tells us. A session that
  // expires was never paid, so case 1 is closed out here by stamping the row
  // status='expired' (payment_status stays 'pending' — nothing was ever charged,
  // so 'refunded' would be a lie). Case 2 is then, by elimination, the ONLY way a
  // gift row can still read pending+unexpired well past a Checkout Session's ~24h
  // lifetime — which is the money-in-no-credit signature, cleanly queryable:
  //
  //   select * from gift_cards
  //    where payment_status = 'pending' and status <> 'expired'
  //      and created_at < now() - interval '24 hours';
  //
  // Policy for such a row is REPORT, never auto-expire and never auto-mint:
  // only Stripe knows whether that charge captured, so a human (or the
  // money-reconciliation sweep) must resolve it against the PaymentIntent.
  if ((meta?.kind as string | undefined) === "gift_card_purchase") {
    const { data: expired, error: expireErr } = await supabase
      .from("gift_cards")
      .update({ status: "expired" })
      .eq("stripe_session_id", session.id)
      // Never touch a gift that actually got paid. If a completion raced ahead
      // of this expiry, payment_status is already 'paid' and this matches zero
      // rows, which is the correct outcome.
      .eq("payment_status", "pending")
      .select("id");

    if (expireErr) {
      // Throw so the outer handler rolls back the idempotency row and returns
      // 500, letting Stripe retry. A plain return acks 200 permanently and the
      // abandoned pre-registration is indistinguishable forever from the
      // money-in-no-credit case above — which would poison the one query that
      // exists to find real losses.
      throw new Error(
        `Failed to expire pre-registered gift card for expired checkout ${session.id}: ${expireErr.message}`,
      );
    }
    // A null error is not a write: report which happened.
    logStep(
      expired && expired.length > 0
        ? "Abandoned gift purchase — pre-registered credit marked expired"
        : "Expired checkout — gift purchase already paid or not pre-registered, left alone",
      { sessionId: session.id },
    );
  }

  const giftCardId = meta?.gift_card_id;
  if (!giftCardId) return; // not a gift card difference checkout — nothing further to unwind

  // Free the gift only if THIS session was the job's live checkout. Two taps
  // either side of create-payment's 10-minute key bucket (Q770) open two
  // sessions for one reservation; only one is stamped on the job, and the
  // other expires ~10 min earlier. Un-reserving on that orphan's expiry would
  // leave the stamped session payable with the gift back in 'sent', so the
  // consume on completion matches nothing and the gift is spent twice.
  if (jobId) {
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .select("stripe_session_id, payment_status")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr) {
      throw new Error(`Failed to read job ${jobId} before un-reserving gift ${giftCardId} on expired checkout ${session.id}: ${jobErr.message}`);
    }
    const superseded = !!job?.stripe_session_id && job.stripe_session_id !== session.id;
    const funded = !!job && !["unpaid", "failed", "abandoned"].includes(job.payment_status ?? "unpaid");
    if (superseded || funded) {
      logStep("Expired checkout — job holds another session or is funded, gift reservation left alone", {
        giftCardId, sessionId: session.id, jobId,
      });
      return;
    }
  }

  const { data: freed, error: freeErr } = await supabase
    .from("gift_cards")
    .update({ status: "sent", job_id: null })
    .eq("id", giftCardId)
    .eq("status", "reserved")
    .select("id")
    .maybeSingle();

  if (freeErr) {
    // Throw so the outer handler rolls back the idempotency row and returns 500,
    // letting Stripe retry once the DB recovers. A plain `return` here commits
    // the dedupe row and acks 200 permanently — leaving the gift card in
    // "reserved" state forever with no retry path and no ops alert. The
    // recipient's gift is then unusable on any other job until someone manually
    // repairs the gift_cards row.
    throw new Error(`Failed to un-reserve gift card ${giftCardId} on expired checkout ${session.id}: ${freeErr.message}`);
  }
  if (freed) {
    logStep("Abandoned difference checkout — gift card un-reserved", { giftCardId, sessionId: session.id });
  } else {
    logStep("Expired checkout — gift card already consumed/not reserved, no-op", { giftCardId, sessionId: session.id });
  }
}
