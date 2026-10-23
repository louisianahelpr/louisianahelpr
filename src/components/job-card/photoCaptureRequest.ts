/**
 * THE FACE ASKS FOR THE PHOTO, THE OPEN CARD TAKES IT (owner, 2026-10-23: "like before and after photos were
 * required on the last tracker we need to keep that also"). When the card's line says "Take the before photo" /
 * "Take the after photo", the collapsed card's one button says the same thing; a tap opens the card and leaves a
 * one-shot request here, and the card's own photo control (PhotoProof, the row's primary while that photo is owed)
 * opens its capture dialog when it draws. The upload, the gates and the server triggers are unchanged.
 * A separate map from helperStepRequest on purpose: the tracker clears that one on every draw. An old request expires.
 * Guard: src/test/trackerKeepsThePhotos.test.tsx.
 */
const REQUEST_TTL_MS = 10_000;
const pending = new Map<string, { type: "before" | "after"; at: number }>();

export function requestPhotoCapture(jobId: string, type: "before" | "after"): void {
  pending.set(jobId, { type, at: Date.now() });
}

/** True once, for the photo control of that type, while the request is fresh. Only a match clears it. */
export function takePhotoCapture(jobId: string, type: "before" | "after"): boolean {
  const req = pending.get(jobId);
  if (!req || req.type !== type) return false;
  pending.delete(jobId);
  return Date.now() - req.at < REQUEST_TTL_MS;
}
