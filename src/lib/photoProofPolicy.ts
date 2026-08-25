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
 */
export interface RequiredProof {
  before: boolean;
  after: boolean;
  /** User-facing statement of the rule, for the gate toasts and the red note. */
  reason: string;
}

export function requiredProof(_job?: { budget?: number | null }): RequiredProof {
  return {
    before: true,
    after: true,
    reason: "Before & after photos are required — they're the proof that releases your payment.",
  };
}

/** Does this job's proof state satisfy {@link requiredProof}? */
export function hasRequiredProof(
  job: { budget?: number | null } | undefined,
  beforeUrls: readonly string[] | null | undefined,
  afterUrls: readonly string[] | null | undefined,
): boolean {
  const req = requiredProof(job);
  return (
    (!req.before || (beforeUrls?.length ?? 0) > 0) &&
    (!req.after || (afterUrls?.length ?? 0) > 0)
  );
}
