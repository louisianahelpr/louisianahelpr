import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";

// A recipient started paying the shortfall on a Pay-It-Forward gift (their
// credit was smaller than the job budget), so create-payment's PIF branch
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
  // Runs for EVERY expired checkout, not just the PIF branch below.
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
      .eq("payment_status", "unpaid")
      .select("id")
      .maybeSingle();
    if (releaseErr) {
      // Throw for the same reason the PIF branch below does: a plain return
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
  }

  const pifCreditId = meta?.pif_credit_id;
  if (!pifCreditId) return; // not a PIF difference checkout — nothing further to unwind

  const { data: freed, error: freeErr } = await supabase
    .from("pif_credits")
    .update({ status: "sent", job_id: null })
    .eq("id", pifCreditId)
    .eq("status", "reserved")
    .select("id")
    .maybeSingle();

  if (freeErr) {
    // Throw so the outer handler rolls back the idempotency row and returns 500,
    // letting Stripe retry once the DB recovers. A plain `return` here commits
    // the dedupe row and acks 200 permanently — leaving the PIF credit in
    // "reserved" state forever with no retry path and no ops alert. The
    // recipient's gift is then unusable on any other job until someone manually
    // repairs the pif_credits row.
    throw new Error(`Failed to un-reserve pif credit ${pifCreditId} on expired checkout ${session.id}: ${freeErr.message}`);
  }
  if (freed) {
    logStep("Abandoned difference checkout — pif credit un-reserved", { pifCreditId, sessionId: session.id });
  } else {
    logStep("Expired checkout — pif credit already consumed/not reserved, no-op", { pifCreditId, sessionId: session.id });
  }
}
