/** The dashboard JobCard's props (moved out of JobCard.tsx to keep the component under its size ratchet). */
import type { EnrichedJob } from "./types";

export interface JobCardProps {
  job: EnrichedJob;
  effectiveFee: number;
  currentUserId?: string;
  showApply?: boolean;
  onApply: (jobId: string) => void;
  onReport: (jobId: string) => void;
  onSelect: (job: EnrichedJob) => void;
  index?: number;
  isExpanded?: boolean;
  onToggleExpand?: (jobId: string) => void;
  isSaved?: boolean;
  onToggleSave?: (jobId: string, saved: boolean) => void;
  /**
   * Guest/read-only variant for the public Browse page. Makes the card body
   * inert and pins a persistent "Sign up to apply" CTA footer instead of a
   * silent whole-card tap. Pricing still shows the helper-side net "You earn"
   * take-home (driven by `effectiveFee`) — guests want to see what they'd
   * pocket. The signed-in Dashboard leaves this unset (behaviour unchanged).
   */
  variant?: "default" | "guest";
  /**
   * Show the gross posted budget + neutral "Budget" label instead of the
   * helper-side "You earn" net-pay figure — WITHOUT adopting the full
   * `variant="guest"` treatment (which also pins a "Sign up to apply" lock
   * footer to every card). Used by the native guest dashboard, where the
   * "Need help, or want to earn?" framing is two-sided, so a one-sided
   * "You earn" label misreads for a visitor who wants to post/hire.
   */
  guestPricing?: boolean;
  /**
   * Viewer's cached location (from useUserLocation, session-cached). When
   * present + the job resolves to a parish centroid, the meta row leads
   * with a "~X mi" distance pill. Hidden silently otherwise so a denied
   * location prompt never makes the card look broken.
   */
  userLat?: number | null;
  userLng?: number | null;
  /**
   * Marks this card as one of the top relevance-matched picks. When true a
   * small, unobtrusive "Recommended" pill renders near the category label.
   * Only the first couple of recommended cards set this — the rest of the
   * feed leaves it false and shows no pill.
   */
  recommended?: boolean;
  /**
   * Drops the card's own outer chrome (corners, border, shadow, background, hover lift) so it can sit
   * inside a container that already draws that shape — the map pin's callout bubble (owner, 2026-08-30:
   * "should be 1 component not multiple": `.mk-bubble` and this card each drew a rounded rect, so the
   * popup read as a card in a card). Everything below the wrapper is unchanged; only its paint is dropped.
   */
  bare?: boolean;
  /** Board 6: the feed's first card, with the 16:10 picture band on top. */
  hero?: boolean;
}
