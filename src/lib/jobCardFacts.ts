/** Small facts a job card reads off its job row (moved out of AppliedJobCard.tsx, componentSizeRatchet). */
type JobFacts = { title?: string | null; description: string; proof_before_urls?: readonly string[] | null; proof_after_urls?: readonly string[] | null };

/** Does the description say anything the TITLE hasn't already said? A job
 *  whose description is its own title back again is one line of duplication. */
export function descriptionAddsToTitle(job: JobFacts): boolean {
  return job.description.trim().toLowerCase() !== (job.title || "").trim().toLowerCase();
}

/** Is there anything behind the Photos chip? Gated on the photos EXISTING,
 *  because the chip opens a dialog and an empty one is a dead-end tap. */
export function hasProofPhotos(job: JobFacts): boolean {
  return (job.proof_before_urls?.length ?? 0) > 0 || (job.proof_after_urls?.length ?? 0) > 0;
}
