/**
 * THE FACE ASKS, THE OPEN CARD ACTS, for the steps that are not tracker steps (owner, 2026-10-23, card critique
 * item 1): the day-before confirm ("I'm still on" / "Confirm you'll be at the job"). The collapsed card's one
 * button opens the card and leaves a one-shot request; the control that owns the step (JobConfirmation) opens ITS
 * OWN dialog when it next draws, so every gate and the confirmation dialog still decide. A separate map from helperStepRequest on purpose: the tracker clears that one
 * on every draw. An old request expires.
 */
const REQUEST_TTL_MS = 10_000;
const pending = new Map<string, { action: FaceRequest; at: number }>();

/** "open": only open the card (its own steps: no-show, dispute, revision, tip and review); no control takes it. */
type FaceRequest = "confirm" | "approve" | "cancel" | "edit" | "open";

export function requestFaceAction(jobId: string, action: FaceRequest): void {
  pending.set(jobId, { action, at: Date.now() });
}

/** True once, for the control that owns `action`, while the request is fresh. Only a match clears it. */
export function takeFaceAction(jobId: string, action: FaceRequest): boolean {
  const req = pending.get(jobId);
  if (!req || req.action !== action) return false;
  pending.delete(jobId);
  return Date.now() - req.at < REQUEST_TTL_MS;
}

/** Whether a fresh request waits for this job's card (any action), without taking it: a Posted `&manage=1` link
 *  with one opens the card (its control answers); one without opens the job page (LEAD-JOBPAGE-LAYOUT). */
export function hasFaceAction(jobId: string): boolean {
  const req = pending.get(jobId);
  return !!req && Date.now() - req.at < REQUEST_TTL_MS;
}
