/** The 30-minute done floor's start, as a pure helper app-shared code can import (libImportsNoPages). */

/** Why Mark job complete is greyed, the one sentence: the job page, the card's face and the Working step. */
export function doneFloorNote(minutesLeft: number): string {
  return `Available in ${minutesLeft} min — 30 minutes after you arrived, to ensure quality.`;
}

/**
 * When the 30-minute floor starts: the EARLIER of the Helpr's arrival and the
 * poster's "Confirm they're working", ignoring a missing one (SQL LEAST). The
 * poster's confirm comes after the Helpr starts working, so in practice this is
 * the arrival: a late confirm never restarts the clock (audit 2026-10-28 F12).
 * Null when neither is stamped (no floor). Every client copy reads this.
 */
export function doneFloorStart(posterConfirmedWorkingAt: string | null | undefined, arrivedAt: string | null | undefined): string | null {
  const stamps = [posterConfirmedWorkingAt, arrivedAt].filter((t): t is string => !!t && Number.isFinite(Date.parse(t)));
  if (stamps.length === 0) return null;
  return stamps.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
}
