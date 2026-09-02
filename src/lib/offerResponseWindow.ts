/**
 * How long an offer is held open for the helpr it was sent to.
 *
 * Two flows produce an offer and both are on the same clock now:
 *  - accepting an application (ResponseDeadlineDialog → jobs.response_deadline)
 *  - a direct offer at post time (DirectOfferBanner → jobs.direct_offer_expires_at)
 *
 * The second used to hardcode 24 hours with no picker at all, even though
 * `auto-expire-jobs` documents the window as "whatever the poster picked …
 * 1/2/4/8h". The server side (`expire_pending_direct_offers`) has always just
 * honoured whatever timestamp is stored, so the only thing missing was the
 * choice.
 */

export interface OfferResponseWindow {
  /** Hours, as a string — it is a <Select> value. */
  value: string;
  label: string;
}

/** The offered windows, shortest first. Shared by both offer flows. */
export const OFFER_RESPONSE_WINDOWS: OfferResponseWindow[] = [
  { value: "1", label: "1 hour" },
  { value: "2", label: "2 hours" },
  { value: "4", label: "4 hours" },
  { value: "8", label: "8 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
  { value: "48", label: "48 hours" },
];

/** Falls back to the historic direct-offer window. */
export const DEFAULT_OFFER_RESPONSE_HOURS = 24;

/** Human phrasing for a window, for banner/notification copy. */
export function offerWindowLabel(hours: number): string {
  return hours === 1 ? "1 hour" : `${hours} hours`;
}
