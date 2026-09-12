import type { JobCategory } from "./jobCategories";

/**
 * Whether a job category should PRE-SET the before/after photo-proof
 * requirement on. The poster can always override it in the Post a Job form —
 * this is the starting position, not a rule.
 *
 * ON where the work leaves a visible result, so a before/after pair is real
 * evidence that the job was done: cleaning, yard work, handyman, moving,
 * assembly, painting, storm prep, events (setup and breakdown are both
 * visible). `other` is ON too, matching the column's own DEFAULT true — an
 * unclassifiable job is the one most likely to need evidence, and the
 * conservative side of this choice is the side that keeps the proof.
 *
 * OFF where a photo pair means nothing: a delivery, an errand, a dog walk.
 * There is no "before" state of a package that was not there yet, and
 * demanding one is what blocked helpers from completing those jobs at all.
 *
 * The DB column stays NOT NULL DEFAULT true, so a path that never asks this
 * question still gets the historic always-on behaviour.
 */
const PHOTO_PROOF_DEFAULT_OFF: ReadonlySet<string> = new Set<JobCategory>([
  "errands",
  "delivery",
  "pet_care",
]);

/** Pre-set for the photo-proof toggle, given the chosen category. */
export function defaultRequirePhotoProof(category: string): boolean {
  return !PHOTO_PROOF_DEFAULT_OFF.has(category);
}
