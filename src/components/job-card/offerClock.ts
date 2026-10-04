/**
 * The clock on an offer a Helpr has not answered yet, and whether it has run
 * out. ONE predicate for one fact: the offer card shows "This offer has
 * expired" from it, and the Activity buckets and status line file the card
 * from it, so the card can never say "expired" while its tab says Needs You
 * (owner, 2026-10-03: "If the offer expired then it should no longer be in
 * needs you"). The server agrees on its next run: expire_unanswered_offers
 * files the application as rejected and reopens the job, and
 * expire_pending_direct_offers marks a direct offer expired.
 */

/** A direct offer's card is synthetic: useActivityData gives it the id `direct-<job id>`. */
export const isDirectOffer = (app: { id: string }) => app.id.startsWith("direct-");

/**
 * How long a helper has to respond once a poster hands them a job, when the
 * poster didn't set an explicit deadline. Mirrors the 24h
 * `direct_offer_expires_at` that jobSubmitHelpers stamps on a direct offer.
 */
export const DEFAULT_RESPONSE_WINDOW_HOURS = 24;

export interface OfferClock {
  /** The backend-stamped deadline: `response_deadline`, else `direct_offer_expires_at`. */
  hardDeadline: string | null;
  /** The 24-hour rule applied to the offer stamp, for legacy rows with no hard deadline. */
  derivedDeadline: string | null;
  /** Time is up on either clock: the offer is gone. */
  isExpired: boolean;
}

/**
 * THE CLOCK, in priority order.
 *
 * 1. `response_deadline` — stamped by accept_application on an offer that
 *    came from the helper's own application.
 * 2. `direct_offer_expires_at` — stamped by jobSubmitHelpers on a direct
 *    offer.
 * 3. Derived: the offer stamp + the 24-hour rule. `updated_at` is the write
 *    that moved this application into the offered state (the helper cannot
 *    edit an offer, so nothing else touches the row here), so this is the
 *    documented rule applied to a real timestamp — not a number invented to
 *    fill a gap.
 *
 * NEVER derived for a SYNTHETIC direct-offer row: its `updated_at` is the
 * JOB row's updated_at (useActivityData copies it in), which moves on any
 * write to the job — so a clock derived from it restarts arbitrarily. A
 * direct offer carries a real `direct_offer_expires_at` stamp anyway.
 *
 * TIME UP MEANS THE OFFER IS GONE — from either clock (owner: "once the time
 * is up they no longer have the option if the job was reoffered elsewhere").
 * The derived clock only decides for a row with no hard deadline.
 */
export function offerClock(
  app: { id: string; updated_at?: string | null },
  job: { response_deadline?: string | null; direct_offer_expires_at?: string | null } | null | undefined,
  now: number = Date.now(),
): OfferClock {
  const stamped = app.updated_at ? new Date(app.updated_at).getTime() : NaN;
  // An unparseable stamp derives no clock (it must never throw for the whole list).
  const derivedDeadline = !isDirectOffer(app) && Number.isFinite(stamped)
    ? new Date(stamped + DEFAULT_RESPONSE_WINDOW_HOURS * 3_600_000).toISOString()
    : null;
  const hardDeadline = job?.response_deadline ?? job?.direct_offer_expires_at ?? null;
  const derivedClosed = !hardDeadline && !!derivedDeadline && new Date(derivedDeadline).getTime() <= now;
  const isExpired = (!!hardDeadline && new Date(hardDeadline).getTime() <= now) || derivedClosed;
  return { hardDeadline, derivedDeadline, isExpired };
}
