/** Where the compact rail's cursor sits, given the same inputs the full rail
 *  derives from. One definition of the `includePostingSteps` offset, so the
 *  two rails cannot disagree about which step a job is on. `preStepCount` is
 *  JobTracking's PRE_STATUSES.length (the steps before anyone is offered the job). */
export function railDisplayIdx({
  currentStatusIdx,
  includePostingSteps,
  helperId,
  preStepCount,
}: {
  currentStatusIdx: number;
  includePostingSteps: boolean;
  helperId: string | null | undefined;
  preStepCount: number;
}): number {
  if (!includePostingSteps) return currentStatusIdx;
  return helperId ? preStepCount + currentStatusIdx : 0;
}
