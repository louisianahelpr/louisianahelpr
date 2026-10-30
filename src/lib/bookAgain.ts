/**
 * "Book <Helpr> again" (owner idea Q2471 #3, 2026-10-29): one tap from a
 * finished job copies that job (title, details, category, address, price and
 * notes, never the date), sends it to the same Helpr as a direct offer, and
 * opens Post a job at When and where, so the only thing left to answer is the
 * date.
 *
 * It is a different control from "Hire again", which stays a BLANK post to the
 * same Helpr (owner 2026-10-25: "the job shouldn't open the post filled in
 * already"; the next job may be something else). Both reuse the existing
 * pieces: `?rebook=` (useJobFormEffects' copy, which never copies a date or an
 * offer) and `?offerTo=` (the direct-offer banner and offered_to_helper_id on
 * submit). `bookAgain=1` only says "open at When and where".
 */
export const BOOK_AGAIN_PARAM = "bookAgain";

/** The Post a job link for "Book <Helpr> again" on a finished job. */
export function bookAgainLink(jobId: string, helperId: string): string {
  const q = new URLSearchParams({ rebook: jobId, offerTo: helperId, [BOOK_AGAIN_PARAM]: "1" });
  return `/post-job?${q.toString()}`;
}

/**
 * Does this Post a job link open at When and where? Only the full Book again
 * link: the copy (`rebook`) AND the offer (`offerTo`) AND the flag. A plain
 * Repost or Hire again still walks the form from the start.
 */
export function prefillOpensWhen(searchParams: URLSearchParams): boolean {
  return !!(searchParams.get(BOOK_AGAIN_PARAM) && searchParams.get("rebook") && searchParams.get("offerTo"));
}

/** "Book Andre again" from a display name like "Andre L."; "Book again" with no usable name. */
export function bookAgainLabel(displayName: string | null | undefined): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || first === "Helpr") return "Book again";
  return `Book ${first} again`;
}
