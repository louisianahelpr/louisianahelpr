/**
 * What the tracker's line says, as a code (F260q): jobNextStep keys off it, never off English words, so the line can be
 * worded in any language. Tiny on purpose: jobNextStep reads it without loading jobProgressState's derivation.
 */

/** The lines jobNextStep turns into a step of its own: the Helpr is working (poster), someone offered you the job (Helpr);
 *  and after photos are in, not marked done (jobProgress keeps that line over the card's). */
export type NextLineId = "working" | "offered_you" | "after_photos";

/** The code for what `next` says, or null when `next` was not made with one (or was replaced after it was made). */
export function nextLineCode(p: { next: string; nextCode?: { id: NextLineId; line: string } }): NextLineId | null {
  return p.nextCode && p.nextCode.line === p.next ? p.nextCode.id : null;
}

/** A line with its deadline handed back separately (F260q): `text` + " " + `by` is exactly `line`. */
export type NextBy = { line: string; text: string; by: string };

/** The step and its deadline when `next` was made with one (and not replaced since), else null. */
export function nextLineBy(p: { next: string; nextBy?: NextBy }): { text: string; by: string } | null {
  return p.nextBy && p.nextBy.line === p.next ? { text: p.nextBy.text, by: p.nextBy.by } : null;
}
