/**
 * THE FACE ASKS, THE TRACKER ACTS (boards 62 and 64; lead 2026-10-20).
 *
 * The Working card's face button names the Helpr's real next step ("I'm on my way", "Mark
 * done"). Tapping it opens the card and leaves a one-shot request here; the tracker
 * (JobTracking) takes it the first time it draws that SAME step and presses its own button,
 * so every gate (day-before confirm, arrival, photos, the 30-minute floor, Done's
 * confirmation) still decides. A request the tracker does not match is dropped, and an old
 * one expires, so nothing fires later by surprise.
 */
const REQUEST_TTL_MS = 10_000;
const pending = new Map<string, { step: string; at: number }>();

export function requestHelperStep(jobId: string, step: string): void {
  pending.set(jobId, { step, at: Date.now() });
}

/** True once, when the tracker draws the step the face asked for. Any draw clears it. */
export function takeHelperStepRequest(jobId: string, step: string): boolean {
  const req = pending.get(jobId);
  if (!req) return false;
  pending.delete(jobId);
  return req.step === step && Date.now() - req.at < REQUEST_TTL_MS;
}
