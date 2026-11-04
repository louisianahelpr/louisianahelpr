/**
 * The accessible name of the job card's ask for a before/after proof photo, in both shapes PhotoProof draws:
 *   - the step's PRIMARY (JobStepPrimaryButton): "Take after photo" (sentence case since a45ad9f49a, 2026-10-29;
 *     photoPrimaryLabel). The money loop's regex still said "Take After photo", so every scheduled
 *     e2e-real-backend run from 10-30 failed "the card never asked for the after photo" (41038050144, 41623278596);
 *   - the outline chip: "After photo — add the after photo for this job".
 * Restated here, never imported from the app, so the test does not grade the app with its own rule.
 */
export function photoAskName(type: "before" | "after"): RegExp {
  const askLabel = type === "before" ? "Before photo" : "After photo";
  return new RegExp(`^(Take ${type} photo|${askLabel} — add the ${type} photo for this job)$`);
}
