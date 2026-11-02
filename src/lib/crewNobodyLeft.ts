// Pure: no imports, so a first-screen reader does not pull src/lib/crewLifecycle.ts (and the crew RPCs) in.
/**
 * JOBS-3 follow-up (lead verdict 10-31): every confirmed member of an under-way crew was reported a no-show, so
 * nobody is left on the roster and nobody can finish. The roll-up never completes, so the poster's way out is
 * Cancel: poster_cancel_job (newest 20261031220849) accepts in_progress, prices no share for an empty roster
 * (v_committed false, no crew_cancellation_fee_shares row, fee 0, not late, no poster strike) and refunds in full.
 * Each no-show already had their strike from rpc_poster_report_member_no_show. `rosterKnown` is false until the
 * roster has loaded, so a crew whose members are still loading is never offered this.
 * Guard: src/test/crewAllNoShowCanCancel.test.tsx.
 */
export function crewNobodyLeft(
  jobStatus: string | null | undefined,
  roster: ReadonlyArray<{ helper_id: string | null }>,
  rosterKnown: boolean,
  started = false,
): boolean {
  // A3-31 (audit 11-01): a crew turns in_progress only when a member sets out or checks in, so a crew whose every
  // member was a no-show never set out and is still "accepted". Once its start has passed it is the same case.
  const underWay = jobStatus === "in_progress" || (jobStatus === "accepted" && started);
  return rosterKnown && underWay && !roster.some((m) => m.helper_id != null);
}
