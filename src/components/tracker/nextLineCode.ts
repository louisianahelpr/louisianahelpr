/**
 * What the tracker's line says, as a code (F260q): jobNextStep keys off it, never off English words, so the line can be
 * worded in any language. Tiny on purpose: jobNextStep reads it without loading jobProgressState's derivation.
 */

/** The lines jobNextStep turns into a step of its own: the Helpr is working (poster), someone offered you the job (Helpr). */
export type NextLineId = "working" | "offered_you";

/** The code for what `next` says, or null when `next` was not made with one (or was replaced after it was made). */
export function nextLineCode(p: { next: string; nextCode?: { id: NextLineId; line: string } }): NextLineId | null {
  return p.nextCode && p.nextCode.line === p.next ? p.nextCode.id : null;
}
