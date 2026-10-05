/**
 * Is a crew job booked? (Q707, owner 2026-10-05.)
 *
 * A crew stays `open` while it fills, so the poster's card stays on its Open
 * step, which offered Edit. But once any member is hired the server refuses
 * the poster's date, time, place and detail changes: enforce_poster_jobs_money_lock
 * treats the job as booked when `jobs.helper_id` is set OR a
 * `group_job_helpers` row names a Helpr (`helper_id IS NOT NULL`; a departed
 * member's row is anonymised to NULL and does not count). The owner's rule:
 * once a crew is hired, changes go only through a request the crew agrees to
 * (the same rule as Q1204 for a single booking; that request is Q1254), so
 * Edit is hidden on a booked crew.
 *
 * This mirrors the server's test exactly; src/test/crewBookedHidesEdit.test.ts
 * holds the two equal.
 */
export function crewIsBooked(
  job: { is_group_job?: boolean | null },
  roster: ReadonlyArray<{ helper_id: string | null }> | null | undefined,
): boolean {
  if (job.is_group_job !== true) return false;
  return (roster ?? []).some((m) => m.helper_id != null);
}
