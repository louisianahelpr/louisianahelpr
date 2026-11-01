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

/** Exactly the shape captureCardHold answers (supabase/functions/_shared/cardHold.ts). */
export type InstantCaptureResult =
  | { ok: true; already: boolean }
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
  | "captured_not_hired"; // charged, and the completion refused: paged, retried next run

export type InstantSweepDeps = {
  // deno-lint-ignore no-explicit-any
  db: any;
  capture: (jobId: string) => Promise<InstantCaptureResult>;
  now: number;
  record: (defect: string) => void;
  page: (title: string, message: string, fields: Record<string, unknown>) => Promise<void>;
};

export const INSTANT_BOOKING_COLUMNS =
  "status, payment_status, helper_id, offered_to_helper_id, direct_offer_status, instant_decline_until";

async function readBooking(db: InstantSweepDeps["db"], jobId: string): Promise<InstantBookingRow | null> {
  const { data, error } = await db.from("jobs").select(INSTANT_BOOKING_COLUMNS).eq("id", jobId).maybeSingle();
  if (error) throw new Error(`instant booking read failed for job ${jobId}: ${error.message}`);
  return (data as InstantBookingRow | null) ?? null;
}

/** A booking is live while its offer is pending on an open, unhired job inside or past its window. */
export function isLiveBooking(row: InstantBookingRow | null): row is InstantBookingRow & { offered_to_helper_id: string; instant_decline_until: string } {
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
  // An early confirm's capture was refused: the job is off the listing already.
  if (row.payment_status === "failed") return endForPayment(deps, jobId);
  if (Date.parse(row.instant_decline_until) > deps.now) return "none";

  const helperId = row.offered_to_helper_id;
  const captured = await deps.capture(jobId);
  if (!captured.ok) {
    if (captured.reason === "retry") {
      deps.record(`job ${jobId}: instant booking capture will retry: ${captured.detail}`);
      return "retry";
    }
    if (captured.reason === "poster_must_pay") return endForPayment(deps, jobId);
    // not_held: the job moved under us (closed, paid another way). Re-read: a
    // booking still live on money that is not a hold is a defect to look at.
    if (isLiveBooking(await readBooking(deps.db, jobId))) {
      deps.record(`job ${jobId}: an instant booking is live but its job is not on a card hold`);
    }
    return "none";
  }

  // Captured (now, or by an earlier run / the Helpr's own confirm): complete the hire.
  const { data: done, error: doneErr } = await deps.db.rpc("complete_direct_offer_accept", { p_job_id: jobId, p_helper: helperId });
  if (!doneErr && done != null) return "hired";
  // Another run (or the Helpr's confirm) hired them in the moment between.
  const after = await readBooking(deps.db, jobId);
  if (after && after.status !== "open" && after.helper_id === helperId) return "hired";
  const why = doneErr?.message ?? "the hire did not complete";
  deps.record(`job ${jobId}: captured for an instant booking that did not complete (${why}); retried next run`);
  await deps.page(
    "An instant booking was charged but the hire did not complete",
    "card-hold-sweep captured the poster's held card when the 2-hour window ended, and complete_direct_offer_accept refused. The next run retries; if it keeps failing, the job is funded with nobody hired.",
    { job_id: jobId, helpr: helperId, error: why.slice(0, 200) },
  );
  return "captured_not_hired";
}
