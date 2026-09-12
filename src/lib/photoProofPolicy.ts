/**
 * photoProofPolicy — the ONE definition of which proof photos a helper must
 * upload before a job can be marked complete.
 *
 * Three surfaces enforce this gate — ActiveJobSection's "I'm Done — Request
 * Payout" button, JobTracking's Done step, and useLifecycleHandlers'
 * completeJob re-check — and they had drifted into three different rules
 * (before+after on every job vs after-only on $50+ jobs), with a red note
 * ("After-photos required for jobs $50+") stating a third variant neither
 * button actually enforced. The buttons' rule is the real one: before AND
 * after photos on every job, because they are the evidence that releases an
 * escrowed payment regardless of its size.
 *
 * `job` is accepted (rather than the rule being two bare constants) so a
 * future budget- or category-scoped carve-out changes exactly one function.
 * That carve-out arrived 2026-09-11 as `jobs.require_photo_proof`, and it
 * changed exactly this function.
 *
 * WHY THE CLIENT MAY TRUST THE FLAG. The requirement was never client-side:
 * `trg_helper_completion_gates` → `enforce_helper_completion_gates()` raises
 * `completion_requires_proof_photos` (23514) on the UPDATE that stamps
 * `helper_completed_at`. The migration that adds the column patches that
 * trigger to read `COALESCE(NEW.require_photo_proof, true)` in the SAME file,
 * so the column can never exist on a database whose gate does not honour it —
 * and `?? true` below means a client running against a database that predates
 * both keeps today's behaviour. Verified against prod 2026-09-11: before the
 * deploy, neither the column nor the relaxed gate is there.
 *
 * The arrival gate and the 30-minute work floor are untouched by any of this
 * and still fire. A completion that fails is therefore not necessarily a photo
 * problem — read which exception came back before saying so.
 */
export interface RequiredProof {
  before: boolean;
  after: boolean;
  /** User-facing statement of the rule, for the gate toasts and the red note. */
  reason: string;
}

export interface PhotoProofJob {
  budget?: number | null;
  /** Poster's per-job answer. Absent (pre-migration client or row) = required. */
  require_photo_proof?: boolean | null;
}

export function requiredProof(job?: PhotoProofJob): RequiredProof {
  if (job?.require_photo_proof === false) {
    return {
      before: false,
      after: false,
      reason: "This poster doesn't need photos for this job.",
    };
  }
  return {
    before: true,
    after: true,
    reason: "Before & after photos are required — they're the proof that releases your payment.",
  };
}

/** Does this job's proof state satisfy {@link requiredProof}? */
export function hasRequiredProof(
  job: PhotoProofJob | undefined,
  beforeUrls: readonly string[] | null | undefined,
  afterUrls: readonly string[] | null | undefined,
): boolean {
  const req = requiredProof(job);
  return (
    (!req.before || (beforeUrls?.length ?? 0) > 0) &&
    (!req.after || (afterUrls?.length ?? 0) > 0)
  );
}
