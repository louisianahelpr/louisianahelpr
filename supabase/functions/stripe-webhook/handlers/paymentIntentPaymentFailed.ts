import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { insertNotifications } from "../../_shared/insertNotifications.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

/**
 * The payment states that say "the poster's money is here". A failure event
 * for the job's own PaymentIntent on a job in one of these is NOT stale: an
 * ACH (us_bank_account) debit is reported as a completed checkout days before
 * the bank settles it, and can also fail AFTER it first succeeded (a late bank
 * return). Job 7440a72d (2026-10-12/15) sat in 'escrow' for days after its
 * debit failed with insufficient_funds because this handler ignored every
 * job past unpaid: it was hired, offered, reminded and re-broadcast as funded.
 */
const FUNDED_PAYMENT_STATES = new Set(["escrow", "payout_pending", "released"]);

/** Live PaymentIntent statuses that mean the money did not, and will not, arrive. */
const FAILED_PI_STATUSES = new Set(["requires_payment_method", "canceled"]);

/**
 * A failure on a job that is marked funded: take it out of escrow when (and
 * only when) the failing PaymentIntent is the one that funded the job AND
 * Stripe's live view of it is a genuine failure. Everything else is a stale or
 * unrelated event and is acked without a write.
 */
async function unfundFailedEscrow(
  // deno-lint-ignore no-explicit-any
  job: any,
  piId: string,
  { supabase, stripe, logStep }: WebhookContext,
): Promise<void> {
  if (job.stripe_payment_intent_id !== piId) {
    // A different PI (an earlier declined attempt, a re-delivery) carrying the
    // same job_id. The job was funded by its own PI; this says nothing about it.
    logStep("payment_failed for a PI that did not fund this job — ignored", {
      jobId: job.id, piId, fundedBy: job.stripe_payment_intent_id ?? null, paymentStatus: job.payment_status,
    });
    return;
  }
  // Decide on Stripe's live state, never the event payload alone: a retried
  // ACH debit that has since succeeded must not be un-funded by an old event.
  // A Stripe error throws, so the event is retried rather than lost.
  const live = await stripe.paymentIntents.retrieve(piId);
  const liveStatus = (live as { status?: string | null }).status ?? null;
  if (!liveStatus || !FAILED_PI_STATUSES.has(liveStatus)) {
    logStep("payment_failed on a funded job but the live PI is not failed — ignored", {
      jobId: job.id, piId, liveStatus,
    });
    return;
  }

  if (job.payment_status === "released") {
    // The Helpr was already paid from money that never arrived. Nothing here
    // can undo a transfer; a person must decide (reverse the transfer or
    // absorb it). Page, write nothing.
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Bank payment failed AFTER the payout was released",
      message: `The poster's payment for job ${job.id} ("${job.title}") failed (PaymentIntent ${piId} is ${liveStatus}), but the job is already 'released': the Helpr was paid from money that never arrived. Decide whether to reverse the transfer.`,
      fields: { job_id: job.id, payment_intent: piId, pi_status: liveStatus },
      oncePerDayKey: `funded-job-payment-failed-released:${job.id}`,
      seed: job.is_seed ?? false,
    });
    return;
  }

  // Pinned to the PI and to the funded state we read: a concurrent refund,
  // cancel or release that moved the job first wins, and this matches 0 rows.
  // stripe_session_id is cleared (as for an unpaid ACH bounce) so the poster
  // can start a new checkout.
  const { data: unfunded, error: unfundErr } = await supabase
    .from("jobs")
    .update({ payment_status: "failed", stripe_session_id: null })
    .eq("id", job.id)
    .eq("stripe_payment_intent_id", piId)
    .in("payment_status", ["escrow", "payout_pending"])
    .select("id")
    .maybeSingle();
  if (unfundErr) {
    throw new Error(`Failed to take job ${job.id} out of escrow after payment failure: ${unfundErr.message}`);
  }
  if (!unfunded) {
    logStep("payment_failed on a funded job matched 0 rows — job moved on concurrently", {
      jobId: job.id, piId, paymentStatus: job.payment_status,
    });
    return;
  }
  logStep("Funded job's payment failed — taken out of escrow", { jobId: job.id, piId, from: job.payment_status, liveStatus });

  // Copy follows where the job is (lh-money-escrow review): a 'failed' job is
  // hidden from My Posts and a hired or finished job cannot be checked out
  // again, so no notice promises a button that is not there.
  const hired = Boolean(job.helper_id && job.helper_confirmed_at);
  const workDone = ["completed", "disputed", "revision_requested"].includes(String(job.status)) ||
    job.payment_status === "payout_pending";
  const notices: Record<string, unknown>[] = [];
  if (job.customer_id) {
    notices.push({
      user_id: job.customer_id,
      job_id: job.id,
      title: "Your bank payment failed",
      message: hired
        ? `Your bank payment for "${job.title}" didn't go through, so this job isn't paid for. You haven't been charged. We've let your Helpr know.`
        : `Your bank payment for "${job.title}" didn't go through, so this job isn't paid for and Helprs can't see it or be hired for it. You haven't been charged.`,
      type: "warning",
      link: null,
    });
  }
  // Only a Helpr who had confirmed is told: an unconfirmed offer is refused
  // by the funding gate on accept, and telling them would only confuse.
  if (hired) {
    const ask = workDone
      ? "so the payout for it is on hold. We'll let you know what happens next."
      : job.status === "in_progress"
        ? "so the job isn't paid for. Please stop work on it for now; we'll let you know if it's paid again."
        : "so the job isn't paid for. Please don't start work on it; we'll let you know if it's paid again.";
    notices.push({
      user_id: job.helper_id,
      job_id: job.id,
      title: "Job payment failed",
      message: `The poster's payment for "${job.title}" didn't go through, ${ask}`,
      type: "warning",
      link: `/jobs?job=${job.id}`,
    });
  }
  if (notices.length > 0) await insertNotifications(supabase, notices);

  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "critical",
    title: "A funded job's payment failed — taken out of escrow",
    message: `Job ${job.id} ("${job.title}") was '${job.payment_status}' but its PaymentIntent ${piId} is ${liveStatus}. It is now payment_status='failed'; the poster${hired ? " and the confirmed Helpr were" : " was"} told. Its job status ('${job.status}') was left as it is.`,
    fields: { job_id: job.id, payment_intent: piId, pi_status: liveStatus, job_status: job.status ?? null },
    oncePerDayKey: `funded-job-payment-failed:${job.id}`,
    seed: job.is_seed ?? false,
  });
}

/**
 * Checks the live Checkout Session and PaymentIntent status before any DB write.
 *
 * Returns:
 *   closed        — the payment definitively failed; send a notice if applicable
 *   clearSessionId — write stripe_session_id = null in the same atomic update
 *   stale         — event is superseded; ack with no write at all
 *
 * Q769: "open" session → closed=false, no notice (poster can still retry).
 * ME-046: ACH session is "complete" immediately; we no longer null stripe_session_id
 *   at ACH checkout (that caused void-cancelled-payments to abandon funded jobs
 *   within 1h), so we check Stripe directly.
 * Duplicate-notice prevention: "expired" → closed=false (checkoutSessionExpired
 *   notifies on a failed job; treating expired as closed would double-fire).
 * Stale-event guard: Stripe retries a failed event for up to 3 days. A card-decline
 *   event re-delivered after the poster switched to ACH must not mark the job failed.
 *   We use an ALLOW-LIST (only requires_payment_method and canceled are genuine
 *   failures) — a deny-list misses requires_action, which appears during
 *   microdeposit verification and bank-transfer funding, both enabled on this
 *   account's default payment method configuration.
 * Error ordering: called BEFORE any DB write; a transient throw leaves nothing
 *   committed, so Stripe retries cleanly and the notice is not permanently lost.
 */
async function checkSessionStatus(
  sessionId: string | null | undefined,
  piId: string,
  stripe: Stripe,
): Promise<{ closed: boolean; clearSessionId: boolean; stale?: boolean }> {
  if (!sessionId) return { closed: true, clearSessionId: false };
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    } as Parameters<typeof stripe.checkout.sessions.retrieve>[1]);
    if (session.status === "open") return { closed: false, clearSessionId: false };
    if (session.status === "complete") {
      const sessionPiRaw = (session as any).payment_intent as
        | Stripe.PaymentIntent
        | string
        | null
        | undefined;
      const sessionPiId =
        typeof sessionPiRaw === "string"
          ? sessionPiRaw
          : typeof sessionPiRaw === "object" && sessionPiRaw !== null
          ? sessionPiRaw.id
          : undefined;

      // Known session PI differs from this event's PI — late re-delivery for an
      // earlier PaymentIntent (e.g. a card decline redelivered after ACH checkout).
      if (sessionPiId !== undefined && sessionPiId !== piId) {
        return { closed: false, clearSessionId: false, stale: true };
      }

      // Determine the PI's live status. When the expand returned an object, read it
      // directly. Otherwise retrieve separately — falling through on a non-expanded
      // string would decide money on a mock default rather than the live PI state.
      let piStatus: string | null = null;
      if (typeof sessionPiRaw === "object" && sessionPiRaw !== null && sessionPiRaw.id === piId) {
        piStatus = sessionPiRaw.status ?? null;
      } else {
        // expand was not honoured (non-expanded string id or undefined). Retrieve
        // separately so we never skip the status check in production.
        const livePi = await stripe.paymentIntents.retrieve(piId);
        piStatus = (livePi as any).status ?? null;
      }

      // Allow-list: only these two statuses confirm a genuine payment failure.
      // Any other status — requires_action (microdeposits / bank transfer in
      // progress), processing, succeeded, etc. — means money is still in flight
      // or has already settled. Treat as stale to avoid a false "not posted" notice.
      if (piStatus !== "requires_payment_method" && piStatus !== "canceled") {
        return { closed: false, clearSessionId: false, stale: true };
      }

      // Genuine ACH bounce. Clear stripe_session_id so create-payment can mint a
      // new checkout and the draft card stops showing "payment in progress".
      // Safe from void-cancelled-payments Parts B/B2/C: those sweeps only read
      // payment_status='unpaid'; this write sets 'failed' simultaneously.
      return { closed: true, clearSessionId: true };
    }
    // "expired": checkoutSessionExpired notifies on a failed job — don't double-fire.
    return { closed: false, clearSessionId: false };
  } catch (e) {
    if ((e as any)?.statusCode === 404 || (e as any)?.code === "resource_missing") {
      return { closed: true, clearSessionId: false };
    }
    // Any other Stripe error: throw so Stripe retries and the notice is not lost.
    throw new Error(`Stripe session lookup failed (${sessionId}): ${(e as Error).message}`);
  }
}

export async function handlePaymentIntentPaymentFailed(
  event: Stripe.Event,
  ctx: WebhookContext,
): Promise<void> {
  const { supabase, stripe, logStep } = ctx;
  const pi = event.data.object as Stripe.PaymentIntent;
  const failedEmail = pi.receipt_email || (pi as any).last_payment_error?.charge?.billing_details?.email;
  logStep("Payment intent failed", { id: pi.id, email: failedEmail });

  // ME-040: jobs.stripe_payment_intent_id is only written on the SUCCESS path;
  // a card decline never lands there. Use metadata.job_id (stamped unconditionally
  // by create-payment, create-boost-payment, etc.) to find the job instead.
  // Tips and boosts are not the job's own payment — do not mark the job failed.
  if (pi.metadata?.type === "tip") return;
  if (pi.metadata?.kind === "job_boost") return;
  const jobId = pi.metadata?.job_id;
  const { data: failedJob, error: failedJobErr } = jobId
    ? await supabase
        .from("jobs")
        .select("id, customer_id, title, status, payment_status, stripe_session_id, stripe_payment_intent_id, helper_id, helper_confirmed_at, is_seed")
        .eq("id", jobId)
        .maybeSingle()
    : { data: null, error: null };

  if (failedJobErr) {
    // Throw: rolls back the idempotency row, returns 500, lets Stripe retry.
    throw new Error(`Job lookup failed for failed PI ${pi.id}: ${failedJobErr.message}`);
  }

  if (failedJob && FUNDED_PAYMENT_STATES.has(String(failedJob.payment_status))) {
    await unfundFailedEscrow(failedJob, pi.id, ctx);
    return;
  }

  if (failedJob) {
    // Skip the Stripe session call for jobs already past null/unpaid/failed (e.g.
    // a declined boost on a funded job) — avoids unnecessary Stripe API calls and
    // reduces retry noise during outages for events that hit zero rows anyway.
    const isActionableStatus =
      failedJob.payment_status == null ||
      failedJob.payment_status === "unpaid" ||
      failedJob.payment_status === "failed";

    // Check session + PI status BEFORE any DB write.
    const { closed, clearSessionId, stale } = isActionableStatus
      ? await checkSessionStatus((failedJob as any).stripe_session_id, pi.id, stripe)
      : { closed: false, clearSessionId: false };

    if (stale) {
      logStep("Stale payment_failed — superseded PI; ack without write", {
        jobId: failedJob.id,
        piId: pi.id,
        paymentStatus: failedJob.payment_status,
      });
      return;
    }

    // STATE PRECONDITION (R9): only null/unpaid may be marked failed from a
    // null/expired session (no clearSessionId). Including 'failed' in the CAS
    // without the session-clear guard would re-fire the notice on a job that
    // checkoutSessionExpired already handled — any late retry of a prior decline
    // carrying the same job_id would match and send a second "Payment failed".
    // B1: when clearSessionId is true (ACH session completed and this PI genuinely
    // failed), we also include 'failed' so a card-decline-then-ACH-bounce can still
    // clear the complete session id and notify, even though the card decline already
    // moved the job to 'failed'.
    const updatePayload: Record<string, unknown> = { payment_status: "failed" };
    if (clearSessionId) updatePayload.stripe_session_id = null;
    const casFilter = clearSessionId
      ? "payment_status.is.null,payment_status.eq.unpaid,payment_status.eq.failed"
      : "payment_status.is.null,payment_status.eq.unpaid";

    // Pin the stripe_session_id we read in the update filter so a re-mint race
    // (poster opens a new checkout between our session read and this write) safely
    // produces zero rows rather than falsely failing the new checkout's job.
    const sessionIdVal = (failedJob as any).stripe_session_id as string | null;
    const { data: failedUpdate, error: updateErr } = sessionIdVal != null
      ? await supabase
          .from("jobs")
          .update(updatePayload)
          .eq("id", failedJob.id)
          .eq("stripe_session_id", sessionIdVal)
          .or(casFilter)
          .select("id")
          .maybeSingle()
      : await supabase
          .from("jobs")
          .update(updatePayload)
          .eq("id", failedJob.id)
          .is("stripe_session_id", null)
          .or(casFilter)
          .select("id")
          .maybeSingle();

    if (updateErr) {
      throw new Error(`Failed to mark job ${failedJob.id} as payment_failed: ${updateErr.message}`);
    }
    if (!failedUpdate) {
      // Zero rows: the job moved past unpaid/failed, or the session id changed
      // (re-mint race). Ack without notifying — "the job isn't posted" would be
      // false for a funded job, and would prompt a poster whose checkout is live
      // to pay again (lh-money-escrow review of 15921ea17, 2026-09-27).
      logStep("Stale payment_failed ignored — job is no longer in a fallible state", {
        jobId: failedJob.id,
        paymentStatus: failedJob.payment_status,
      });
      return;
    }
    if (closed && failedJob.customer_id) {
      await insertNotifications(supabase, {
        user_id: failedJob.customer_id,
        job_id: failedJob.id,
        title: "Payment failed",
        message: `Your payment for "${failedJob.title}" didn't go through, so the job isn't posted. Open Post a Job and load your draft to try again.`,
        type: "warning",
        link: "/post-job",
      });
      logStep("Job marked failed; poster notified (session closed or gone)", { jobId: failedJob.id });
    } else {
      logStep("Job marked failed; poster is told on session expiry or session still open", { jobId: failedJob.id });
    }
  }
}
