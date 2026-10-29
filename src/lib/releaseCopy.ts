import { formatPriceExact } from "@/lib/format";

/**
 * The one name for the poster's release step (F33, audit 2026-10-28). The job card's approve button
 * and the sheet it opens both read it, so the two controls for one step never use two verbs again
 * ("Approve & Pay" on the card, "Confirm and release $40" on the sheet). "Release", never "Pay": the
 * poster already paid when they posted (or at hire, under card hold), and this step charges nothing.
 * Guard: src/test/releaseLabelsAgree.test.tsx.
 */
export const RELEASE_ACTION = "Approve and release";

/** The sheet's commit button: the job price when it is the whole release, else the bare words. */
export function releaseActionLabel(jobPrice: number | null | undefined): string {
  return jobPrice ? `${RELEASE_ACTION} $${formatPriceExact(jobPrice)}` : RELEASE_ACTION;
}
