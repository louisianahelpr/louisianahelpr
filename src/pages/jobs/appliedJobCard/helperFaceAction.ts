import type { MineFaceAction } from "@/components/job-card/MineJobFace";

/**
 * The ONE button on the Helpr's Working card face (board 21; lead 2026-10-20).
 *
 *  - A direct offer: none here. OfferedActions (Accept / Decline) already draws
 *    on the closed card and is that card's statement (owner, 2026-10-05).
 *  - Not picked / cancelled (the minimal card): none. Nothing is left to do.
 *  - A finished job this Helpr can still review: "Leave a review", the same
 *    handler as the card's own Leave a Review chip.
 *  - Everything else: "Manage job", which opens the card's live tracker and
 *    its step row (On my way, photos, Start working, Mark done, More) in place.
 */
export function helperFaceAction(s: {
  isMinimalCard: boolean;
  isOffered: boolean;
  owesReview: boolean;
  review: () => void;
  manage: () => void;
}): MineFaceAction | null {
  if (s.isMinimalCard || s.isOffered) return null;
  if (s.owesReview)
    return { label: "Leave a review", onClick: s.review, tone: "primary" };
  return { label: "Manage job", onClick: s.manage, tone: "secondary" };
}
