/**
 * CMP-4 (lead 2026-11-01, design A): the server half of instant book. A poster's
 * "Book now" hands the job to a Helpr as a pending direct offer stamped
 * instant_decline_until = booked + 2 h; the card stays HELD. card-hold-sweep
 * calls settleInstantBooking for each open hold:
 *
 *   - the window is still open (or there is no live booking): nothing;
 *   - the job's payment already failed (an early confirm's capture was
 *     refused): the booking ends now (instant_book_payment_failed tells both);
 *   - the window passed: the hold is captured with the SAME captureCardHold the
 *     Helpr's own accept uses (one claim row, one Stripe idempotency key per
 *     attempt, so two runs never charge twice), then the hire completes with
 *     complete_direct_offer_accept. Stripe refuses the card: the hold code takes
 *     the job off the listing and asks the poster to pay again, and the booking
 *     ends. Stripe did not answer: the next run tries again.
 *
 * The capture is injected, so the money paths are proven without Stripe
 * (src/test/instantBookSweep.test.ts). No floor is read or written here.
 */

import type { InstantRefundOutcome } from "./instantBookRefund.ts";

/** Exactly the shape captureCardHold answers (supabase/functions/_shared/cardHold.ts). */
export type InstantCaptureResult =
  | { ok: true; already: boolean; /** No card hold at all: the job was paid at post, nothing was captured for the booking. */ paidAtPost?: boolean }
  | { ok: false; reason: "poster_must_pay" }
  | { ok: false; reason: "retry"; detail: string }
  | { ok: false; reason: "not_held" };

export type InstantBookingRow = {
  status: string | null;
  payment_status: string | null;
  helper_id: string | null;
  offered_to_helper_id: string | null;
  direct_offer_status: string | null;
  instant_decline_until: string | null;
};

export type InstantSweepOutcome =
  | "none" // no live booking, or the window is still open
  | "hired" // captured (now or already) and the hire completed
  | "payment_failed" // the card was refused: the booking ended, both told
  | "retry" // Stripe did not answer, or another capture holds the claim
  | "ended_unhireable" // the hire's own checks failed before any capture: the booking ended, nothing charged, both told
  | "captured_not_hired"; // charged, and the completion refused in the moment between: the booking ended, poster told, ops paged once

export type InstantSweepDeps = {
  // deno-lint-ignore no-explicit-any
  db: any;
  /** captureCardHold for this Helpr's offer (offerTo): the claim goes back if the offer moved on. */
  capture: (jobId: string, helperId: string) => Promise<InstantCaptureResult>;
  now: number;
  record: (defect: string) => void;
  page: (title: string, message: string, fields: Record<string, string | number | null | undefined>) => Promise<unknown>;
  /**
   * instantBookRefund.ts refundInstantBooking: the job instant_book_captured_not_hired
   * closed for review is refunded in full now (and retried by card-hold-sweep).
   */
  refund: (jobId: string) => Promise<InstantRefundOutcome>;
};

const INSTANT_BOOKING_COLUMNS =
  "status, payment_status, helper_id, offered_to_helper_id, direct_offer_status, instant_decline_until";

async function readBooking(db: InstantSweepDeps["db"], jobId: string): Promise<InstantBookingRow | null> {
  const { data, error } = await db.from("jobs").select(INSTANT_BOOKING_COLUMNS).eq("id", jobId).maybeSingle();
  if (error) throw new Error(`instant booking read failed for job ${jobId}: ${error.message}`);
  return (data as InstantBookingRow | null) ?? null;
}

/** A booking is live while its offer is pending on an open, unhired job inside or past its window. */
function isLiveBooking(row: InstantBookingRow | null): row is InstantBookingRow & { offered_to_helper_id: string; instant_decline_until: string } {
  return !!row && row.status === "open" && row.helper_id == null && row.offered_to_helper_id != null &&
    row.direct_offer_status === "pending" && row.instant_decline_until != null;
}

async function endForPayment(deps: InstantSweepDeps, jobId: string): Promise<InstantSweepOutcome> {
  const { data, error } = await deps.db.rpc("instant_book_payment_failed", { p_job_id: jobId });
  if (error) {
    deps.record(`job ${jobId}: an instant booking whose payment failed was not ended (${error.message}); retried next run`);
    return "retry";
  }
  // false: another run (or a decline) already ended it.
  return data === true ? "payment_failed" : "none";
}

export async function settleInstantBooking(deps: InstantSweepDeps, jobId: string): Promise<InstantSweepOutcome> {
  const row = await readBooking(deps.db, jobId);
  if (!isLiveBooking(row)) return "none";
  if (row.payment_status === "failed") return endForPayment(deps, jobId);
  if (Date.parse(row.instant_decline_until) > deps.now) return "none";

  const helperId = row.offered_to_helper_id;
  // Before any capture, the checks complete_direct_offer_accept runs (block,
  // ban, ID and payout setup, the job still open, the offer still pending):
  // a Helpr who can't be hired ends the booking with nothing charged.
  const { data: ended, error: endErr } = await deps.db.rpc("instant_book_end_if_unhireable", { p_job_id: jobId });
  if (endErr) {
    deps.record(`job ${jobId}: an instant booking's hire checks were not read (${endErr.message}); retried next run`);
    return "retry";
  }
  if (ended === true) return "ended_unhireable";

  const captured = await deps.capture(jobId, helperId);
  if (!captured.ok) {
    if (captured.reason === "retry") {
      deps.record(`job ${jobId}: instant booking capture will retry: ${captured.detail}`);
      return "retry";
    }
    if (captured.reason === "poster_must_pay") return endForPayment(deps, jobId);
    if (isLiveBooking(await readBooking(deps.db, jobId))) {
      deps.record(`job ${jobId}: an instant booking is live but its job is not on a card hold`);
    }
    return "none";
  }

  const { data: done, error: doneErr } = await deps.db.rpc("complete_direct_offer_accept", { p_job_id: jobId, p_helper: helperId });
  if (!doneErr && done != null) return "hired";
  const after = await readBooking(deps.db, jobId);
  if (after && after.status !== "open" && after.helper_id === helperId) return "hired";
  if (doneErr || captured.paidAtPost) {
    // An error is not a refusal (the next run's hire is free: the capture
    // answers "already"). Paid at post, nothing was captured for the booking:
    // the next run's hire checks end it if the Helpr can't be hired.
    deps.record(`job ${jobId}: an instant booking's hire did not complete (${doneErr?.message ?? "refused"}); retried next run`);
    return "retry";
  }
  // The true race: charged, and the hire refused in the moment between.
  return endCapturedNotHired(deps, jobId, helperId, "card-hold-sweep captured the job's held card when the 2-hour window ended, and complete_direct_offer_accept then refused.");
}

/**
 * Charged, and the hire refused: instant_book_captured_not_hired ends the
 * booking, closes the job for review and takes the refund claim (true only the
 * first time for a job), and the full refund runs at once. Ops is paged ONCE
 * per job, on that first true, with what the refund did. Shared by
 * card-hold-sweep and create-payment capture_hold (the Helpr's early confirm).
 */
export async function endCapturedNotHired(
  deps: Pick<InstantSweepDeps, "db" | "record" | "page" | "refund">, jobId: string, helperId: string, how: string,
): Promise<"captured_not_hired" | "none" | "retry"> {
  const { data: first, error: endErr2 } = await deps.db.rpc("instant_book_captured_not_hired", { p_job_id: jobId, p_helper: helperId });
  if (endErr2) {
    deps.record(`job ${jobId}: captured for an instant booking that did not complete, and the booking was not ended (${endErr2.message}); retried next run`);
    return "retry";
  }
  if (first !== true) return "none";
  const refunded = await deps.refund(jobId);
  deps.record(`job ${jobId}: captured for an instant booking whose hire was refused; the job is closed for review and its full refund ${refunded === "refunded" ? "went out" : refunded === "retry" ? "is retried by card-hold-sweep" : "needs a person"}`);
  await deps.page(
    "An instant booking was charged but the hire did not complete",
    `${how} The booking ended and the job is closed for review (status cancelled, payment_status 'cancelling', job_refund_claims holder 'instant_book_refund'), so nobody can be hired on it. Its payment is refunded in full automatically: ${refunded === "refunded" ? "the refund went out. No action needed unless this repeats." : refunded === "retry" ? "Stripe did not answer yet, so card-hold-sweep retries it every run." : refunded === "none" ? "no open instant-book refund claim was found for it; check the job's payment in Stripe." : "the refund stopped; see the \"automatic refund needs a person\" alert."}`,
    { job_id: jobId, helpr: helperId, refund: refunded },
  );
  return "captured_not_hired";
}
